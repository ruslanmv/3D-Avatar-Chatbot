#!/usr/bin/env python3
"""
End-to-end "hello world" smoke test for the full local stack:

    Ollama (light model)
        └─ HomePilot (personas)          http://localhost:8000
              └─ OllaBridge Local        http://localhost:11435
                    └─ yourfriend.online  http://localhost:8080  (3D Avatar Chatbot)

It walks the same request path the avatar uses — an OpenAI-compatible
``POST /v1/chat/completions`` to OllaBridge Local with a HomePilot persona
model — and asserts a non-empty assistant reply to "hello world". That single
call exercises the whole chain: OllaBridge → HomePilot persona → HomePilot's
LLM backend → Ollama, and back.

Zero third-party dependencies (stdlib ``urllib`` only) so it runs anywhere the
other services already run. It VERIFIES a running stack and never installs or
mutates anything — use ``scripts/e2e-local.sh`` to bring the stack up first,
or start each service yourself.

Config via env (all optional; defaults match `make run` on each project):
    OLLAMA_URL       default http://localhost:11434
    HOMEPILOT_URL    default http://localhost:8000
    OLLABRIDGE_URL   default http://localhost:11435
    APP_URL          default http://localhost:8080
    OLLABRIDGE_API_KEY   send as Bearer/X-API-Key when auth mode is `required`
    E2E_MODEL        force a specific model id instead of auto-picking a persona
    E2E_PROMPT       default "hello world"

Exit code 0 = the avatar can chat; non-zero = a layer is down (with guidance).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
HOMEPILOT_URL = os.environ.get("HOMEPILOT_URL", "http://localhost:8000").rstrip("/")
OLLABRIDGE_URL = os.environ.get("OLLABRIDGE_URL", "http://localhost:11435").rstrip("/")
APP_URL = os.environ.get("APP_URL", "http://localhost:8080").rstrip("/")
API_KEY = os.environ.get("OLLABRIDGE_API_KEY", "").strip()
FORCE_MODEL = os.environ.get("E2E_MODEL", "").strip()
PROMPT = os.environ.get("E2E_PROMPT", "hello world")

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def _ok(msg: str) -> None:
    print(f"{GREEN}✓{RESET} {msg}")


def _warn(msg: str) -> None:
    print(f"{YELLOW}!{RESET} {msg}")


def _fail(msg: str, hint: str = "") -> None:
    print(f"{RED}✗ {msg}{RESET}")
    if hint:
        print(f"  {DIM}{hint}{RESET}")


def _req(method: str, url: str, *, headers=None, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (localhost)
        raw = resp.read().decode("utf-8", "replace")
        ctype = resp.headers.get("content-type", "")
        payload = json.loads(raw) if "application/json" in ctype else raw
        return resp.status, payload


def _auth_headers() -> dict:
    h = {
        # Mirror the avatar's own client identification so OllaBridge shapes the
        # response the same way it does for yourfriend.online.
        "X-Client-Type": "vr-chatbot",
        "X-Client-Capabilities": "text_chat,voice_output,image_panel,avatar_pose,avatar_emotion",
    }
    if API_KEY:
        h["Authorization"] = f"Bearer {API_KEY}"
        h["X-API-Key"] = API_KEY
    return h


# ── Step 1: Ollama ───────────────────────────────────────────────────────────

def check_ollama() -> bool:
    try:
        _, data = _req("GET", f"{OLLAMA_URL}/api/tags", timeout=10)
    except Exception as exc:  # noqa: BLE001
        _fail(f"Ollama not reachable at {OLLAMA_URL} ({type(exc).__name__})",
              "Start it with `ollama serve`, then `ollama pull qwen2.5:0.5b`.")
        return False
    models = [m.get("name") for m in (data.get("models") or []) if m.get("name")]
    if not models:
        _fail("Ollama is up but has no models.",
              "Pull a light one: `ollama pull qwen2.5:0.5b` (or llama3.2:1b).")
        return False
    _ok(f"Ollama online — {len(models)} model(s): {', '.join(models[:4])}"
        + (" …" if len(models) > 4 else ""))
    return True


# ── Step 2: HomePilot ──────────────────────────────────────────────────────────

def check_homepilot() -> bool:
    try:
        _, data = _req("GET", f"{HOMEPILOT_URL}/health", timeout=10)
    except Exception as exc:  # noqa: BLE001
        _fail(f"HomePilot not reachable at {HOMEPILOT_URL} ({type(exc).__name__})",
              "In the HomePilot repo: `make install && make run`.")
        return False
    status = data.get("status") if isinstance(data, dict) else None
    _ok(f"HomePilot online — status={status or 'ok'}")
    return True


# ── Step 3: OllaBridge Local ─────────────────────────────────────────────────

def check_ollabridge() -> bool:
    try:
        _, _ = _req("GET", f"{OLLABRIDGE_URL}/health", timeout=10)
    except Exception as exc:  # noqa: BLE001
        _fail(f"OllaBridge Local not reachable at {OLLABRIDGE_URL} ({type(exc).__name__})",
              "In the ollabridge repo: `make run` (serves the gateway on :11435).")
        return False
    _ok(f"OllaBridge Local online at {OLLABRIDGE_URL}")
    return True


def pick_model() -> str | None:
    """Find a model to chat with — prefer a HomePilot persona/personality
    (the whole point of the link), else any available model so the chain is
    still exercised."""
    if FORCE_MODEL:
        _ok(f"Using forced model: {FORCE_MODEL}")
        return FORCE_MODEL
    try:
        _, data = _req("GET", f"{OLLABRIDGE_URL}/v1/models", headers=_auth_headers(), timeout=15)
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            _fail("OllaBridge returned 401 listing models.",
                  "Set OLLABRIDGE_API_KEY, or run OllaBridge in local-trust mode.")
        else:
            _fail(f"OllaBridge /v1/models failed (HTTP {exc.code}).")
        return None
    except Exception as exc:  # noqa: BLE001
        _fail(f"Could not list OllaBridge models ({type(exc).__name__}).")
        return None

    entries = data.get("data") if isinstance(data, dict) else None
    ids = [m.get("id") for m in (entries or []) if isinstance(m, dict) and m.get("id")]
    if not ids:
        _fail("OllaBridge published no models.",
              "Enable HomePilot + share models in the OllaBridge dashboard.")
        return None

    personas = [i for i in ids if i.startswith("persona:") or i.startswith("personality:")]
    if personas:
        _ok(f"Found {len(personas)} HomePilot agent(s); chatting with: {personas[0]}")
        return personas[0]
    _warn(f"No HomePilot personas published — falling back to model: {ids[0]}")
    _warn("  (Enable HomePilot in OllaBridge → Local Runtimes to expose personas.)")
    return ids[0]


# ── Step 4: the app is served (optional; chat path is asserted via OllaBridge) ─

def check_app() -> bool:
    try:
        status, _ = _req("GET", f"{APP_URL}/", timeout=10)
    except Exception as exc:  # noqa: BLE001
        _warn(f"yourfriend.online app not reachable at {APP_URL} ({type(exc).__name__}).")
        _warn("  The chat path below is still asserted directly against OllaBridge.")
        _warn("  To serve the app: in the 3D-Avatar-Chatbot repo run `make start`.")
        return False
    _ok(f"yourfriend.online served at {APP_URL} (HTTP {status})")
    return True


# ── Step 5: the hello-world chat — the actual E2E assertion ──────────────────

def say_hello(model: str) -> bool:
    url = f"{OLLABRIDGE_URL}/v1/chat/completions"
    body = {
        "model": model,
        "messages": [{"role": "user", "content": PROMPT}],
        "max_tokens": 128,
    }
    print(f"{DIM}→ POST {url}  model={model}  prompt={PROMPT!r}{RESET}")
    try:
        status, data = _req("POST", url, headers=_auth_headers(), body=body, timeout=120)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        _fail(f"Chat request failed (HTTP {exc.code}).", detail)
        return False
    except Exception as exc:  # noqa: BLE001
        _fail(f"Chat request errored ({type(exc).__name__}: {exc}).")
        return False

    reply = ""
    if isinstance(data, dict):
        choices = data.get("choices") or []
        if choices and isinstance(choices[0], dict):
            reply = (choices[0].get("message") or {}).get("content", "") or ""
    reply = reply.strip()
    if not reply:
        _fail("Chat returned an empty reply.", f"Raw: {json.dumps(data)[:300]}")
        return False

    _ok(f"Avatar replied (HTTP {status}): {reply[:200]}")
    return True


def main() -> int:
    print("── yourfriend.online end-to-end: hello world ──\n")
    steps_ok = True
    steps_ok &= check_ollama()
    steps_ok &= check_homepilot()
    if not check_ollabridge():
        steps_ok = False
    check_app()  # informational only — not required for the API-level assertion

    if not steps_ok:
        print(f"\n{RED}A required service is down — fix the items above and re-run.{RESET}")
        return 1

    model = pick_model()
    if not model:
        return 1

    print()
    if not say_hello(model):
        print(f"\n{RED}E2E FAILED — the chain is up but the chat did not complete.{RESET}")
        return 1

    print(f"\n{GREEN}E2E PASSED — Ollama → HomePilot → OllaBridge → avatar chat works.{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
