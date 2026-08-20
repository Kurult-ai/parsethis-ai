"""
parse-agents SDK — Drop-in interceptor for OpenAI and Anthropic Python clients.

Wraps any OpenAI-compatible or Anthropic-compatible client so that every
``chat.completions.create()`` or ``messages.create()`` call is automatically
screened by the Parse API (https://parsethis.ai).

Example (OpenAI)::

    from openai import OpenAI
    from parse_agents import wrap

    client = wrap(
        OpenAI(api_key="..."),
        agent_id="billing-bot",
        environment="production",
        parse_api_key="pfa_live_...",
        parse_base_url="https://parsethis.ai",
    )

    # Every call is now screened — no further code changes needed.
    res = client.chat.completions.create(...)

Example (Anthropic)::

    from anthropic import Anthropic
    from parse_agents import wrap

    client = wrap(
        Anthropic(),
        agent_id="billing-bot",
        environment="production",
        parse_api_key="pfa_live_...",
        parse_base_url="https://parsethis.ai",
    )

    res = client.messages.create(...)
"""

from __future__ import annotations

import json
import functools
import threading
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Callable, List

__version__ = "0.2.0"
__all__ = [
    "wrap",
    "screen_prompt",
    "screen_output",
    "verify_agent_trust",
    "ParseApiError",
    "ParseScreeningError",
    "ParseSdkConfig",
    "get_stats",
]

# ─── Types ───────────────────────────────────────────────────────────────────


@dataclass
class ParseSdkConfig:
    """Configuration for the Parse SDK wrapper."""

    parse_api_key: str
    agent_id: str
    environment: str
    parse_base_url: str = "https://parsethis.ai"
    data_sources: List[str] = field(default_factory=list)
    fail_posture: str = "fail_open"  # "fail_open" | "fail_closed"
    # What to do when Parse releases a block on a semantic acquittal
    # (``released_from_block.released`` is true).
    #
    #   "block"    -- refuse it, exactly as if it had blocked. Default.
    #   "allow"    -- let it through. Only sane if you review released prompts.
    #   "callback" -- ask ``on_released_prompt`` and use its answer.
    #
    # The default is the strict one: upgrading this SDK must not loosen
    # anybody's posture. A released prompt comes back below the risk bands
    # this SDK gates on, so without this it would simply pass.
    on_released: str = "block"  # "block" | "allow" | "callback"
    on_released_prompt: Optional[Callable[[Dict[str, Any], str], bool]] = None
    # Called when the server returns ``disposition: "review"`` -- the engine
    # found something and is not confident about it.
    #
    # **Without a handler, a review blocks.** A third state nobody handles is a
    # hole, not a feature: the point is that a human looks, and an SDK that
    # quietly passed it through would be asserting the opposite.
    on_review: Optional[Callable[[Dict[str, Any]], bool]] = None
    screen_output: bool = True
    parse_timeout: float = 10.0  # seconds


def _blocked(parse_resp: Optional[Dict[str, Any]], on_review: Optional[Any] = None) -> bool:
    """A verdict this SDK refuses.

    Reads ``recommended_action`` as well as the risk bands. It previously read
    only the bands, which made it blind to the frozen-agent kill switch (verdict
    "block") and to any action-level decision.

    ``disposition`` is authoritative when the server sends it. The risk bands
    describe the *finding*; the disposition describes what to do about it, and a
    ``report`` is a real finding at verdict ``critical`` that the caller has
    explicitly declared is subject matter rather than an instruction.

    **An unrecognised disposition blocks.** Failure mode #3 in the acquittal
    register was exactly this: a new server-side state ("sandbox") that neither
    SDK knew about, so a released verdict reached the model verbatim. Any future
    state fails closed here until a client is taught to handle it.
    """
    if not parse_resp:
        return False

    disposition = parse_resp.get("disposition")
    if disposition is not None:
        if disposition == "allow":
            return False
        if disposition == "report":
            # The finding stands and is on the response for the caller to act
            # on; the refusal does not, because they told us they will not
            # execute this content.
            return False
        if disposition == "review":
            # No handler means nobody is looking, which is the one thing this
            # state must not mean.
            return on_review is None
        if disposition == "block":
            return True
        return True  # unknown state — fail closed

    # Server predates the disposition field — the behaviour it had before.
    if parse_resp.get("verdict") in ("critical", "high_risk", "block"):
        return True
    return parse_resp.get("recommended_action") == "block"


def _release_blocked(
    parse_resp: Optional[Dict[str, Any]],
    config: "ParseSdkConfig",
    prompt: str,
) -> bool:
    """True when Parse released a block and this client will not accept it.

    A released prompt comes back below the risk bands — medium_risk / sandbox —
    so a client gating on bands alone treats it as safe. That is precisely how
    the two previous attempts at the release feature turned "release to sandbox"
    into "release to allow" in production. Default is to refuse.
    """
    release = (parse_resp or {}).get("released_from_block") or {}
    if not release.get("released"):
        return False
    if config.on_released == "allow":
        return False
    if config.on_released == "callback" and config.on_released_prompt:
        try:
            return not bool(config.on_released_prompt(release, prompt))
        except Exception:
            # A throwing callback must not open the gate.
            return True
    return True


class ParseScreeningError(Exception):
    """Raised when a prompt is blocked and ``fail_posture='fail_closed'``."""

    def __init__(
        self,
        message: str,
        verdict: str = "",
        risk_score: float = 0,
        flags: Optional[list] = None,
        categories: Optional[list] = None,
    ):
        super().__init__(message)
        self.verdict = verdict
        self.risk_score = risk_score
        self.flags = flags or []
        self.categories = categories or []


@dataclass
class UsageStats:
    total_calls: int = 0
    blocked_calls: int = 0
    total_tokens: int = 0


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _get_path(obj: Any, path: list) -> Any:
    cur = obj
    for seg in path:
        if cur is None or not isinstance(cur, dict):
            return None
        cur = cur.get(seg)
    return cur


def _extract_prompt(body: Any) -> str:
    """Extract a plain-text prompt from an OpenAI or Anthropic request body."""
    if not isinstance(body, dict):
        return ""

    messages = body.get("messages")
    if isinstance(messages, list):
        parts = []
        for msg in messages:
            if msg is None:
                continue
            content = msg.get("content") if isinstance(msg, dict) else None
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        parts.append(str(block.get("text", "")))
        return "\n".join(parts)

    prompt = body.get("prompt")
    if isinstance(prompt, str):
        return prompt

    return json.dumps(body)[:2000]


def _extract_output_text(response: Any) -> str:
    """Extract the assistant response text from an OpenAI or Anthropic response."""
    if not isinstance(response, dict):
        return ""

    # OpenAI
    openai_content = _get_path(response, ["choices", 0, "message", "content"])
    # choices is a list — _get_path needs dict-aware handling
    choices = response.get("choices")
    if isinstance(choices, list) and len(choices) > 0:
        choice = choices[0]
        if isinstance(choice, dict):
            msg = choice.get("message")
            if isinstance(msg, dict):
                content = msg.get("content")
                if isinstance(content, str):
                    return content

    # Anthropic
    content = response.get("content")
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
        if parts:
            return "\n".join(parts)

    return ""


def _extract_tokens(response: Any) -> int:
    if not isinstance(response, dict):
        return 0
    usage = response.get("usage")
    if not isinstance(usage, dict):
        return 0

    total = usage.get("total_tokens")
    if isinstance(total, (int, float)):
        return int(total)

    in_tok = usage.get("input_tokens", 0)
    out_tok = usage.get("output_tokens", 0)
    return int(in_tok or 0) + int(out_tok or 0)


def _parse_call(
    endpoint: str,
    payload: dict,
    config: ParseSdkConfig,
) -> Optional[dict]:
    """Send a non-throwing POST to the Parse API. Returns JSON dict or None."""
    base_url = config.parse_base_url.rstrip("/")
    url = f"{base_url}{endpoint}"
    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config.parse_api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=config.parse_timeout) as resp:
            if resp.status < 200 or resp.status >= 300:
                return None
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, json.JSONDecodeError):
        return None


def _make_safe_response(body: Any, kind: str, parse_resp: dict) -> dict:
    """Build a safe placeholder response for fail_open mode."""
    import time

    model = body.get("model", "parse-screened") if isinstance(body, dict) else "parse-screened"
    ts = str(int(time.time() * 1000))
    verdict = parse_resp.get("verdict", "high_risk")
    risk_score = parse_resp.get("risk_score", 0)

    if kind == "message":
        return {
            "id": f"parse_blocked_{ts}",
            "type": "message",
            "role": "assistant",
            "model": model,
            "content": [
                {
                    "type": "text",
                    "text": "This request was blocked by Parse prompt screening for safety reasons.",
                }
            ],
            "stop_reason": "parse_screening",
            "usage": {"input_tokens": 0, "output_tokens": 0},
            "_parse": {
                "blocked": True,
                "verdict": verdict,
                "riskScore": risk_score,
            },
        }

    return {
        "id": f"parse_blocked_{ts}",
        "object": "chat.completion",
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "This request was blocked by Parse prompt screening for safety reasons.",
                },
                "finish_reason": "parse_screening",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "_parse": {
            "blocked": True,
            "verdict": verdict,
            "riskScore": risk_score,
        },
    }


# ─── Intercept wrapper ───────────────────────────────────────────────────────


def _intercept_async(
    original: Callable,
    kind: str,
    config: ParseSdkConfig,
    stats: UsageStats,
) -> Callable:
    """Wrap an async create() method with pre/post screening."""

    @functools.wraps(original)
    async def wrapper(*args, **kwargs):
        stats.total_calls += 1
        body = args[0] if args else kwargs

        # Pre-call screening
        prompt = _extract_prompt(body)
        if prompt:
            parse_resp = _parse_call(
                "/v1/parse",
                {
                    "prompt": prompt,
                    "model": body.get("model") if isinstance(body, dict) else None,
                    "metadata": {
                        "agent_id": config.agent_id,
                        "environment": config.environment,
                        "data_sources": config.data_sources,
                        "source": "sdk",
                        "source_kind": "user",
                    },
                },
                config,
            )

            if _release_blocked(parse_resp, config, prompt):
                stats.blocked_calls += 1
                if config.fail_posture == "fail_closed":
                    raise ParseScreeningError(
                        "Input blocked by Parse (released from block by "
                        f"{(parse_resp or {}).get('released_from_block', {}).get('released_by', 'semantic acquittal')}; "
                        "set on_released to change this)",
                        verdict=(parse_resp or {}).get("verdict", ""),
                        risk_score=(parse_resp or {}).get("risk_score", 0),
                        flags=(parse_resp or {}).get("flags", []),
                        categories=(parse_resp or {}).get("categories", []),
                    )
                return _make_safe_response(body, kind, parse_resp or {})

            if _blocked(parse_resp, config.on_review):
                stats.blocked_calls += 1
                if config.fail_posture == "fail_closed":
                    raise ParseScreeningError(
                        f"Input blocked by Parse (verdict={parse_resp['verdict']}, risk={parse_resp.get('risk_score')})",
                        verdict=parse_resp.get("verdict", ""),
                        risk_score=parse_resp.get("risk_score", 0),
                        flags=parse_resp.get("flags", []),
                        categories=parse_resp.get("categories", []),
                    )
                return _make_safe_response(body, kind, parse_resp)

        # Execute the original call
        result = await original(*args, **kwargs)

        # Record token usage
        if isinstance(result, dict):
            tokens = _extract_tokens(result)
            if tokens > 0:
                stats.total_tokens += tokens

        # Post-call output screening
        if config.screen_output:
            output_text = _extract_output_text(result)
            if output_text:
                _parse_call(
                    "/v1/screen-output",
                    {
                        "output": output_text,
                        "context": prompt,
                        "metadata": {
                            "agent_id": config.agent_id,
                            "environment": config.environment,
                            "data_sources": config.data_sources,
                            "source": "sdk",
                        },
                    },
                    config,
                )

        return result

    return wrapper


def _intercept_sync(
    original: Callable,
    kind: str,
    config: ParseSdkConfig,
    stats: UsageStats,
) -> Callable:
    """Wrap a sync create() method with pre/post screening."""

    @functools.wraps(original)
    def wrapper(*args, **kwargs):
        stats.total_calls += 1
        body = args[0] if args else kwargs

        # Pre-call screening
        prompt = _extract_prompt(body)
        if prompt:
            parse_resp = _parse_call(
                "/v1/parse",
                {
                    "prompt": prompt,
                    "model": body.get("model") if isinstance(body, dict) else None,
                    "metadata": {
                        "agent_id": config.agent_id,
                        "environment": config.environment,
                        "data_sources": config.data_sources,
                        "source": "sdk",
                        "source_kind": "user",
                    },
                },
                config,
            )

            if _release_blocked(parse_resp, config, prompt):
                stats.blocked_calls += 1
                if config.fail_posture == "fail_closed":
                    raise ParseScreeningError(
                        "Input blocked by Parse (released from block by "
                        f"{(parse_resp or {}).get('released_from_block', {}).get('released_by', 'semantic acquittal')}; "
                        "set on_released to change this)",
                        verdict=(parse_resp or {}).get("verdict", ""),
                        risk_score=(parse_resp or {}).get("risk_score", 0),
                        flags=(parse_resp or {}).get("flags", []),
                        categories=(parse_resp or {}).get("categories", []),
                    )
                return _make_safe_response(body, kind, parse_resp or {})

            if _blocked(parse_resp, config.on_review):
                stats.blocked_calls += 1
                if config.fail_posture == "fail_closed":
                    raise ParseScreeningError(
                        f"Input blocked by Parse (verdict={parse_resp['verdict']}, risk={parse_resp.get('risk_score')})",
                        verdict=parse_resp.get("verdict", ""),
                        risk_score=parse_resp.get("risk_score", 0),
                        flags=parse_resp.get("flags", []),
                        categories=parse_resp.get("categories", []),
                    )
                return _make_safe_response(body, kind, parse_resp)

        # Execute the original call
        result = original(*args, **kwargs)

        # Record token usage
        if isinstance(result, dict):
            tokens = _extract_tokens(result)
            if tokens > 0:
                stats.total_tokens += tokens

        # Post-call output screening
        if config.screen_output:
            output_text = _extract_output_text(result)
            if output_text:
                _parse_call(
                    "/v1/screen-output",
                    {
                        "output": output_text,
                        "context": prompt,
                        "metadata": {
                            "agent_id": config.agent_id,
                            "environment": config.environment,
                            "data_sources": config.data_sources,
                            "source": "sdk",
                        },
                    },
                    config,
                )

        return result

    return wrapper


# ─── Intercepting proxy ──────────────────────────────────────────────────────


class _InterceptedAttr:
    """
    Wrapper around a client sub-object (e.g. ``client.chat`` or
    ``client.messages``) that intercepts ``create()`` calls.
    """

    def __init__(self, target: Any, parent_name: str, config: ParseSdkConfig, stats: UsageStats):
        object.__setattr__(self, "_target", target)
        object.__setattr__(self, "_parent_name", parent_name)
        object.__setattr__(self, "_config", config)
        object.__setattr__(self, "_stats", stats)

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._target, name)
        if name != "create" or not callable(attr):
            return attr

        # Determine kind
        parent = self._parent_name
        if parent == "messages":
            kind = "message"
        elif parent in ("chat", "completions", "beta"):
            kind = "prompt"
        else:
            # Check if target path looks like OpenAI (chat.completions)
            kind = "prompt"

        # Wrap both sync and async — detect coroutine function
        import asyncio

        if asyncio.iscoroutinefunction(attr):
            return _intercept_async(attr, kind, self._config, self._stats)
        else:
            return _intercept_sync(attr, kind, self._config, self._stats)


class _WrappedClient:
    """
    Proxy wrapper that intercepts top-level attributes like ``chat``,
    ``messages``, and ``beta``. All other attribute access passes through
    to the original client.
    """

    _intercept_attrs = {"chat", "messages", "beta", "completions"}

    def __init__(self, client: Any, config: ParseSdkConfig, stats: UsageStats):
        object.__setattr__(self, "_client", client)
        object.__setattr__(self, "_config", config)
        object.__setattr__(self, "_stats", stats)

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._client, name)
        if name in self._intercept_attrs and attr is not None:
            return _InterceptedAttr(attr, name, self._config, self._stats)
        return attr

    def __setattr__(self, name: str, value: Any) -> None:
        if hasattr(self, "_client"):
            setattr(self._client, name, value)
        else:
            object.__setattr__(self, name, value)


# ─── Public API ──────────────────────────────────────────────────────────────


def wrap(
    client: Any,
    *,
    agent_id: str,
    environment: str,
    parse_api_key: str,
    parse_base_url: str = "https://parsethis.ai",
    data_sources: Optional[List[str]] = None,
    fail_posture: str = "fail_open",
    screen_output: bool = True,
    parse_timeout: float = 10.0,
) -> Any:
    """
    Wrap an OpenAI or Anthropic client so every ``create()`` call is screened.

    Args:
        client: An OpenAI or Anthropic client instance.
        agent_id: Identifier for the agent being screened.
        environment: Deployment environment (e.g. ``"production"``).
        parse_api_key: Parse API key (starts with ``pfa_live_``).
        parse_base_url: Base URL of the Parse API.
        data_sources: Optional data source IDs for governance checks.
        fail_posture: ``"fail_open"`` returns a safe response on block;
            ``"fail_closed"`` raises :class:`ParseScreeningError`.
        screen_output: Whether to screen LLM output after the call.
        parse_timeout: Timeout in seconds for Parse API calls.

    Returns:
        A wrapped client proxy. Non-intercepted calls pass through transparently.
    """
    config = ParseSdkConfig(
        parse_api_key=parse_api_key,
        agent_id=agent_id,
        environment=environment,
        parse_base_url=parse_base_url,
        data_sources=data_sources or [],
        fail_posture=fail_posture,
        screen_output=screen_output,
        parse_timeout=parse_timeout,
    )
    stats = UsageStats()
    return _WrappedClient(client, config, stats)


def get_stats(wrapped_client: Any) -> UsageStats:
    """Retrieve usage statistics from a wrapped client."""
    if isinstance(wrapped_client, _WrappedClient):
        return object.__getattribute__(wrapped_client, "_stats")
    raise TypeError("Expected a client returned by parse_agents.wrap()")


# ─── Direct screening client ─────────────────────────────────────────────────
#
# For runtimes that call tools themselves (Hermes, custom agent loops) and do
# not route through an OpenAI/Anthropic client object. Three calls, one per
# trust boundary. Raises ParseApiError on transport or HTTP failure so the
# caller decides its own fail posture — screening a boundary and silently
# ignoring a dead screener is the one behavior this client must not have.


class ParseApiError(Exception):
    """Raised when the Parse API cannot be reached or returns an error."""

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


def _direct_call(
    endpoint: str,
    payload: dict,
    api_key: Optional[str] = None,
    base_url: str = "https://www.parsethis.ai",
    timeout: float = 15.0,
) -> dict:
    import os

    key = api_key or os.environ.get("PARSE_API_KEY", "")
    url = f"{base_url.rstrip('/')}{endpoint}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = ""
        try:
            detail = err.read().decode("utf-8", "replace")[:500]
        except OSError:
            pass
        raise ParseApiError(f"Parse API HTTP {err.code}: {detail}", status=err.code) from err
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as err:
        raise ParseApiError(f"Parse API unreachable: {err}") from err


def screen_prompt(
    prompt: str,
    *,
    api_key: Optional[str] = None,
    base_url: str = "https://www.parsethis.ai",
    metadata: Optional[dict] = None,
    mode: Optional[str] = None,
    timeout: float = 15.0,
) -> dict:
    """Screen untrusted text before it gains authority over tools or memory.

    Latency: ~2-4s on the full pipeline; <100ms with ``mode="pattern-only"``.
    For an owner's own chat messages, pass
    ``metadata={"source_kind": "user", "requester_trust": "owner"}`` so
    correction language ("scratch that, ignore what I said…") softens instead
    of blocking. Send no metadata for third-party content (RAG, email, tool
    output) to keep strict screening.

    Returns the full API response; act on ``recommended_action``.
    """
    payload: dict = {"prompt": prompt}
    if metadata:
        payload["metadata"] = metadata
    if mode:
        payload["mode"] = mode
    return _direct_call("/v1/parse", payload, api_key, base_url, timeout)


def screen_output(
    output: str,
    *,
    api_key: Optional[str] = None,
    base_url: str = "https://www.parsethis.ai",
    metadata: Optional[dict] = None,
    timeout: float = 15.0,
) -> dict:
    """Screen LLM output before showing, storing, or forwarding it."""
    payload: dict = {"output": output}
    if metadata:
        payload["metadata"] = metadata
    return _direct_call("/v1/screen-output", payload, api_key, base_url, timeout)


def verify_agent_trust(
    message: str,
    source_agent: str = "unknown",
    *,
    api_key: Optional[str] = None,
    base_url: str = "https://www.parsethis.ai",
    timeout: float = 15.0,
) -> dict:
    """Verify a peer agent's message before accepting delegated work."""
    payload = {"message": message, "source_agent": source_agent}
    return _direct_call("/v1/agent/trust/verify", payload, api_key, base_url, timeout)
