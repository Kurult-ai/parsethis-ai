#!/usr/bin/env python3
"""
Task 17.5: LLM-Tool Discovery Monitoring Cron

Monitors Parse's discovery surfaces for health and schema validity.
Checks:
  1. Own discovery endpoints return 200 with expected content
  2. Parse appears in major AI tool registries/directories
  3. Schema validity of llms.txt, openapi.json, mcp.json

Output contract:
  - Empty stdout  = everything healthy (cron stays silent)
  - Non-empty stdout = JSON alert with broken surfaces

Uses only Python stdlib. 15s timeout per request.
"""

import json
import ssl
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

BASE_URL = "https://www.parsethis.ai"
TIMEOUT = 15  # seconds

# ---------------------------------------------------------------------------
# Discovery surface definitions
# ---------------------------------------------------------------------------

# (path, expected_content_substrings) — case-insensitive substring match
SURFACE_CHECKS = [
    ("/mcp", ["mcp", "parse"]),
    ("/openapi.json", ["openapi"]),
    ("/llms.txt", ["parse"]),
    ("/v1/pricing", ["pricing"]),
]

# Additional manifest files to validate schema on
MANIFEST_CHECKS = [
    # (path, required_top_level_keys)
    ("/openapi.json", ["openapi", "info", "paths"]),
    ("/mcp.json", ["name", "tools"]),
]

# Registry/directory surfaces to probe for "parsethis.ai" presence
# These are public pages where AI tools get discovered.
# We check if the page is reachable; presence of parsethis.ai is informational
# (not an alert if absent — registries are opt-in).
REGISTRY_PROBES = [
    ("https://glama.ai/mcp/servers", "parsethis.ai"),
    ("https://mcp.so/", "parsethis.ai"),
    ("https://smithery.ai/", "parsethis.ai"),
]

# Expected content markers for llms.txt sections
LLMS_TXT_REQUIRED_SECTIONS = [
    "## Agent Decision Rule",
    "## Machine-Readable Surfaces",
    "## Authentication",
]


def fetch(url, timeout=TIMEOUT):
    """Fetch a URL and return (status_code, body_text, error_message)."""
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers={
        "User-Agent": "ParseDiscoveryMonitor/1.0",
        "Accept": "*/*",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, body, None
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        return e.code, body, f"HTTP {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        return None, "", f"URL error: {e.reason}"
    except Exception as e:
        return None, "", f"Error: {e}"


def check_discovery_surfaces():
    """Check that each discovery endpoint returns 200 with expected content."""
    issues = []
    for path, expected_substrings in SURFACE_CHECKS:
        url = BASE_URL + path
        status, body, error = fetch(url)
        if error:
            issues.append({
                "surface": path,
                "url": url,
                "problem": f"unreachable: {error}",
            })
            continue
        if status != 200:
            issues.append({
                "surface": path,
                "url": url,
                "problem": f"HTTP {status} (expected 200)",
            })
            continue
        body_lower = body.lower()
        missing = [s for s in expected_substrings if s.lower() not in body_lower]
        if missing:
            issues.append({
                "surface": path,
                "url": url,
                "problem": f"missing expected content: {missing}",
            })
    return issues


def check_manifest_schemas():
    """Validate JSON schema of openapi.json and mcp.json."""
    issues = []
    for path, required_keys in MANIFEST_CHECKS:
        url = BASE_URL + path
        status, body, error = fetch(url)
        if error:
            issues.append({
                "manifest": path,
                "url": url,
                "problem": f"fetch failed: {error}",
            })
            continue
        if status != 200:
            issues.append({
                "manifest": path,
                "url": url,
                "problem": f"HTTP {status} (expected 200)",
            })
            continue
        try:
            data = json.loads(body)
        except json.JSONDecodeError as e:
            issues.append({
                "manifest": path,
                "url": url,
                "problem": f"invalid JSON: {e}",
            })
            continue
        missing_keys = [k for k in required_keys if k not in data]
        if missing_keys:
            issues.append({
                "manifest": path,
                "url": url,
                "problem": f"missing required keys: {missing_keys}",
            })
    return issues


def check_llms_txt_sections():
    """Check that llms.txt contains expected section headers."""
    issues = []
    url = BASE_URL + "/llms.txt"
    status, body, error = fetch(url)
    if error or status != 200:
        return []  # Already caught by surface checks; don't double-report

    missing_sections = [
        s for s in LLMS_TXT_REQUIRED_SECTIONS if s not in body
    ]
    if missing_sections:
        issues.append({
            "surface": "/llms.txt",
            "url": url,
            "problem": f"missing required sections: {missing_sections}",
        })
    return issues


def check_registry_presence():
    """
    Check if parsethis.ai appears on major AI tool discovery registries.

    Returns a list of informational findings (NOT counted as alerts).
    Absence from registries is expected for opt-in directories.
    Only surfaces that are unreachable or broken would be flagged.
    """
    findings = []
    for url, search_term in REGISTRY_PROBES:
        status, body, error = fetch(url)
        if error:
            findings.append({
                "registry": url,
                "status": "unreachable",
                "problem": f"registry unreachable: {error}",
            })
            continue
        if status != 200:
            findings.append({
                "registry": url,
                "status": f"HTTP {status}",
                "problem": "registry returned non-200",
            })
            continue
        # Check presence (informational only)
        found = search_term.lower() in body.lower()
        findings.append({
            "registry": url,
            "status": "reachable",
            "parsethis_listed": found,
        })
    return findings


def main():
    all_issues = []

    # 1. Discovery surface health
    surface_issues = check_discovery_surfaces()
    all_issues.extend(surface_issues)

    # 2. Manifest schema validity
    manifest_issues = check_manifest_schemas()
    all_issues.extend(manifest_issues)

    # 3. llms.txt section completeness
    section_issues = check_llms_txt_sections()
    all_issues.extend(section_issues)

    # 4. Registry presence (informational — only flag broken registries)
    registry_findings = check_registry_presence()
    registry_issues = [
        f for f in registry_findings
        if "problem" in f
    ]
    all_issues.extend(registry_issues)

    # Output contract: empty stdout = healthy, non-empty = alert
    if not all_issues:
        sys.stdout.write("")
        return

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "status": "alert",
        "base_url": BASE_URL,
        "issues": all_issues,
        "registry_info": [
            f for f in registry_findings if "problem" not in f
        ],
        "summary": {
            "total_issues": len(all_issues),
            "surfaces_broken": len(surface_issues),
            "manifests_broken": len(manifest_issues),
            "llms_txt_sections_missing": len(section_issues),
            "registries_broken": len(registry_issues),
        },
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
