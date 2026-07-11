#!/usr/bin/env python3
"""
Parse for Agents: minimal Python agent-loop integration.

Usage:
  PARSE_API_KEY=pfa_live_... python3 examples/agent_loop_python.py

Optional:
  PARSE_BASE_URL=https://www.parsethis.ai python3 examples/agent_loop_python.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

BASE_URL = os.environ.get("PARSE_BASE_URL", "https://www.parsethis.ai")
API_KEY = os.environ.get("PARSE_API_KEY")


class ParseError(RuntimeError):
    def __init__(self, path: str, status: int, body: Any):
        super().__init__(f"Parse {path} failed with HTTP {status}")
        self.path = path
        self.status = status
        self.body = body
        self.retryable = status in (429, 503)


def parse_post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    if not API_KEY:
        raise SystemExit("Set PARSE_API_KEY first. Example: PARSE_API_KEY=pfa_live_... python3 examples/agent_loop_python.py")

    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            text = res.read().decode("utf-8")
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(text) if text else {}
        except json.JSONDecodeError:
            parsed = {"raw": text}
        raise ParseError(path, err.code, parsed) from err


def should_block_parse_result(result: dict[str, Any]) -> bool:
    risk_score = result.get("risk_score") or result.get("riskScore") or result.get("score") or 0
    action = result.get("recommended_action") or result.get("suggested_action") or result.get("decision", {}).get("action")
    return result.get("safe") is False or float(risk_score) >= 7 or str(action or "").lower() in {"block", "deny", "refuse"}


def screen_untrusted_input(prompt: str) -> dict[str, Any]:
    result = parse_post(
        "/v1/parse",
        {
            "prompt": prompt,
            "mode": "pattern-only",
            "execute": False,
            "metadata": {
                "source": "user_input",
                "requester_trust": "unknown",
                "integration": "examples/agent_loop_python.py",
            },
        },
    )
    return {"allowed": not should_block_parse_result(result), "result": result}


def screen_generated_output(output: str, original_prompt: str) -> dict[str, Any]:
    result = parse_post(
        "/v1/screen-output",
        {
            "output": output,
            "context": {
                "source": "agent_output",
                "original_prompt": original_prompt,
                "integration": "examples/agent_loop_python.py",
            },
        },
    )
    return {"allowed": not should_block_parse_result(result), "result": result}


def verify_peer_agent(message: str, source_agent: str) -> dict[str, Any]:
    result = parse_post(
        "/v1/agent/trust/verify",
        {
            "message": message,
            "source_agent": source_agent,
            "context": "peer agent requested delegation or private context",
        },
    )
    verdict = str(result.get("verdict") or result.get("decision", {}).get("verdict") or "").lower()
    risk_score = float(result.get("risk_score") or 0)
    return {"allowed": verdict not in {"block", "deny"} and risk_score < 7, "result": result}


def agent_loop(untrusted_prompt: str) -> str:
    input_check = screen_untrusted_input(untrusted_prompt)
    if not input_check["allowed"]:
        return "I can’t safely act on that request."

    # Replace this with your real model/tool call. Keep privileged tools behind the input check.
    draft_output = f"Safe summary of: {untrusted_prompt}"

    output_check = screen_generated_output(draft_output, untrusted_prompt)
    if not output_check["allowed"]:
        return "I drafted a response, but it failed output safety screening."

    return draft_output


if __name__ == "__main__":
    prompt = " ".join(sys.argv[1:]) or "Summarize this note: ship the beta packet to testers."
    try:
        print(agent_loop(prompt))
    except ParseError as err:
        print(json.dumps({"message": str(err), "status": err.status, "retryable": err.retryable, "body": err.body}, indent=2), file=sys.stderr)
        raise SystemExit(75 if err.retryable else 1)
