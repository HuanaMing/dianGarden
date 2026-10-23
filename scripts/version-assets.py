#!/usr/bin/env python3
"""Add a deployment-version query to local JavaScript and CSS URLs in the HTML artifact."""
import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

if len(sys.argv) != 3:
    raise SystemExit("usage: version-assets.py <html-path> <version-json-path>")

html_path = Path(sys.argv[1])
version_path = Path(sys.argv[2])
payload = json.loads(version_path.read_text(encoding="utf-8-sig"))
version = payload.get("version")
if not isinstance(version, str) or not version.strip():
    raise SystemExit("version.json does not contain a valid version string")
token = re.sub(r"[^A-Za-z0-9._-]+", "-", version).strip("-")
if not token:
    raise SystemExit("version string cannot be used as an asset token")

attribute_pattern = re.compile(r"""(?P<prefix>\b(?:src|href)\s*=\s*["'])(?P<url>[^"']+)(?P<suffix>["'])""", re.IGNORECASE)

def versioned_attribute(match: re.Match[str]) -> str:
    raw_url = match.group("url")
    parts = urlsplit(raw_url)
    if parts.scheme or parts.netloc or raw_url.startswith("/") or not re.search(r"\.(?:js|css)$", parts.path, re.IGNORECASE):
        return match.group(0)
    query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key != "v"]
    query.append(("v", token))
    updated_url = urlunsplit(("", "", parts.path, urlencode(query), parts.fragment))
    return match.group("prefix") + updated_url + match.group("suffix")

html = html_path.read_text(encoding="utf-8-sig")
updated = attribute_pattern.sub(versioned_attribute, html)
if updated == html:
    raise SystemExit("no JavaScript or CSS resource URLs were updated")
html_path.write_text(updated, encoding="utf-8")
print(f"Added deployment token {token} to JavaScript/CSS URLs in {html_path}")
