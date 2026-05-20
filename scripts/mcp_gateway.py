"""
Hermes MCP Gateway — provides Hermes tools to Nova via HTTP.

Runs on port 8899.
Endpoints: POST /search, /extract, /execute, /terminal, /code_review
"""
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import quote

import requests

logging.basicConfig(level=logging.INFO, format="[mcp] %(message)s")
_log = logging.getLogger("mcp")
PORT = int(os.environ.get("MCP_PORT", "8899"))


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------


def _search(query: str, limit: int = 5) -> dict:
    """Web search via DuckDuckGo Lite API."""
    results = []
    try:
        r = requests.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query},
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/120.0.0.0 Safari/537.36"
            },
            timeout=15,
        )
        # Extract results using simple regex on the HTML
        # Each result block looks like:
        # <a rel="nofollow" class="result__a" href="...">Title</a>
        # <a class="result__snippet" href="...">Description</a>
        blocks = re.findall(
            r'<a rel="nofollow" class="result__a" href="(.*?)".*?>(.*?)</a>',
            r.text, re.DOTALL
        )
        snippets = re.findall(
            r'class="result__snippet".*?>(.*?)</(?:a|span)>',
            r.text, re.DOTALL
        )
        for i, (url, title) in enumerate(blocks[:limit]):
            desc = re.sub(r'<[^>]+>', '', snippets[i]).strip() if i < len(snippets) else ""
            results.append({
                "title": re.sub(r'<[^>]+>', '', title).strip(),
                "url": url,
                "description": desc[:300],
            })
    except Exception as e:
        _log.warning("DuckDuckGo search failed: %s", e)

    # Fallback: try DuckDuckGo Instant Answer API
    if not results:
        try:
            r = requests.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json", "no_html": "1"},
                timeout=10,
            )
            data = r.json()
            for topic in data.get("RelatedTopics", []):
                if "Topics" in topic:
                    for sub in topic["Topics"][:limit]:
                        results.append({
                            "title": sub.get("Text", "").split(" A ")[0] if " A " in sub.get("Text", "") else sub.get("Text", ""),
                            "url": sub.get("FirstURL", ""),
                            "description": sub.get("Text", ""),
                        })
                else:
                    results.append({
                        "title": topic.get("Text", "").split(" A ")[0] if " A " in topic.get("Text", "") else topic.get("Text", ""),
                        "url": topic.get("FirstURL", ""),
                        "description": topic.get("Text", ""),
                    })
        except Exception as e2:
            _log.warning("DDG Instant Answer fallback also failed: %s", e2)

    return {"success": True, "data": {"web": results[:limit]}}


def _extract(urls: list) -> dict:
    """Extract content from URLs."""
    results_list = []
    for url in urls[:3]:
        try:
            r = requests.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                                  "Chrome/120.0.0.0 Safari/537.36"
                },
                timeout=15,
            )
            content = r.text
            # Strip tags
            content = re.sub(r'<script[^>]*>.*?</script>', '', content, flags=re.DOTALL)
            content = re.sub(r'<style[^>]*>.*?</style>', '', content, flags=re.DOTALL)
            content = re.sub(r'<[^>]+>', ' ', content)
            content = re.sub(r'\s+', ' ', content).strip()[:5000]
            results_list.append({"url": url, "success": True, "content": content})
        except Exception as e:
            results_list.append({"url": url, "success": False, "error": str(e)})
    return {"success": True, "results": results_list}


def _execute(code: str) -> dict:
    """Execute Python code in a subprocess."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(code)
        f.flush()
        script_path = f.name
    try:
        proc = subprocess.run(
            [sys.executable, script_path],
            capture_output=True, text=True, timeout=30,
            cwd=os.path.expanduser("~"),
        )
        output = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        return {"success": proc.returncode == 0, "output": output[:10000]}
    except subprocess.TimeoutExpired:
        return {"success": False, "output": "Execution timed out after 30s"}
    except Exception as e:
        return {"success": False, "output": str(e)}
    finally:
        try:
            os.unlink(script_path)
        except OSError:
            pass


def _terminal(cmd: str) -> dict:
    """Run a shell command."""
    try:
        proc = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=60,
            cwd=os.path.expanduser("~"),
        )
        output = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        return {"success": proc.returncode == 0, "output": output[:10000]}
    except subprocess.TimeoutExpired:
        return {"success": False, "output": "Command timed out after 60s"}
    except Exception as e:
        return {"success": False, "output": str(e)}


def _code_review(code: str) -> dict:
    """Simple code review: check for common issues."""
    issues = []
    lines = code.split("\n")
    for i, line in enumerate(lines, 1):
        s = line.strip()
        if re.search(r'\b(print|console\.log|fmt\.Print|puts)\s*\(', s) and not s.startswith('#'):
            issues.append({"line": i, "severity": "warning", "message": "Debug print left in code"})
        if "TODO" in s or "FIXME" in s:
            issues.append({"line": i, "severity": "info", "message": f"Unresolved: {s}"})
        if s == "except:" or s == "except :":
            issues.append({"line": i, "severity": "error", "message": "Bare except clause"})
        if re.search(r'(api_key|password|secret|token|auth_key)\s*=\s*["\'][^"\']+["\']', s, re.I) and not s.startswith('#'):
            issues.append({"line": i, "severity": "error", "message": "Possible hardcoded secret"})
    return {"success": True, "issues": issues, "total_lines": len(lines)}


# ---------------------------------------------------------------------------
# HTTP Server
# ---------------------------------------------------------------------------


class MCPHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        _log.info("%s - %s", self.client_address[0], format % args)

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._send_json({"status": "ok", "service": "hermes-mcp-gateway"})
        self._send_json({"error": "Not found"}, 404)

    def _dispatch(self, path: str, body: dict):
        handlers = {
            "/search": lambda: _search(body.get("query", body.get("q", "")),
                                        int(body.get("limit", 5))),
            "/extract": lambda: _extract(body.get("urls", body.get("url", []))),
            "/execute": lambda: _execute(body.get("code", body.get("script", ""))),
            "/terminal": lambda: _terminal(body.get("command", body.get("cmd", ""))),
            "/code_review": lambda: _code_review(body.get("code", body.get("script", ""))),
        }
        handler = handlers.get(path)
        if not handler:
            return None
        return handler()

    def do_POST(self):
        path = self.path.rstrip("/")
        try:
            body = self._read_body()
        except Exception:
            return self._send_json({"error": "Invalid JSON body"}, 400)

        # Normalize urls field
        if "url" in body and "urls" not in body:
            body["urls"] = body["url"]
        if isinstance(body.get("urls", []), str):
            body["urls"] = [body["urls"]]

        result = self._dispatch(path, body)
        if result is None:
            return self._send_json({"error": f"Unknown endpoint: {path}"}, 404)

        self._send_json(result)


def main():
    server = HTTPServer(("127.0.0.1", PORT), MCPHandler)
    _log.info("Hermes MCP Gateway running on http://127.0.0.1:%d", PORT)
    _log.info("Endpoints: POST /search, /extract, /execute, /terminal, /code_review")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        _log.info("Shutting down")
        server.server_close()


if __name__ == "__main__":
    main()
