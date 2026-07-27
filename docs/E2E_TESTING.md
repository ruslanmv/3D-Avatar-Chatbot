# End-to-end "hello world" test

Verifies the **whole local stack** works together by walking the exact path the
avatar uses and asserting a chat reply:

```
Ollama  →  HomePilot  →  OllaBridge Local  →  yourfriend.online
(light      (personas)    (relay gateway)      (3D Avatar Chatbot)
 model)                    :11435               :8080
```

The single assertion is an OpenAI-compatible
`POST /v1/chat/completions` to OllaBridge Local with a HomePilot persona model
and the message `hello world`; a non-empty assistant reply means every layer is
wired correctly.

## Prerequisites

Installed on your machine (not installed by the test):

- [`ollama`](https://ollama.com/download) — and `ollama serve` runnable
- `node` (for the app) and `python3`
- The sibling repos checked out next to this one:

  ```
  ├── HomePilot/
  ├── ollabridge/
  └── 3D-Avatar-Chatbot/   ← this repo
  ```

## One command

From this repo:

```bash
make e2e
```

That runs `scripts/e2e-local.sh`, which:

1. Ensures Ollama is running and pulls a light model (`qwen2.5:0.5b`) if missing.
2. `make install && make run` for **HomePilot**, waits for `:8000/health`.
3. `make install && make run` for **OllaBridge Local**, waits for `:11435/health`.
4. `make start` for **yourfriend.online**, waits for `:8080/`.
5. Runs the hello-world assertion (`tests/e2e/hello_world_e2e.py`).
6. Stops everything it started.

It is **non-destructive**: it never installs system packages and only stops
processes it started.

Useful flags:

```bash
make e2e SKIP_INSTALL=1   # skip `make install` on re-runs (faster)
make e2e KEEP_UP=1        # leave services running afterwards (debugging)
MODEL=llama3.2:1b make e2e
```

## Against an already-running stack

If you started Ollama, HomePilot, OllaBridge, and the app yourself, just assert:

```bash
make e2e-check
# or, with overrides:
OLLABRIDGE_URL=http://localhost:11435 OLLABRIDGE_API_KEY=... \
  python3 tests/e2e/hello_world_e2e.py
```

Config (all optional) via env: `OLLAMA_URL`, `HOMEPILOT_URL`, `OLLABRIDGE_URL`,
`APP_URL`, `OLLABRIDGE_API_KEY` (only when OllaBridge auth mode is `required`;
`local-trust` needs none), `E2E_MODEL` (force a model), `E2E_PROMPT`.

## What "pass" proves

- Ollama is serving a model.
- HomePilot is up and exposing personas.
- OllaBridge Local published at least one HomePilot agent (`persona:` /
  `personality:`) and relays chat to it — falling back to any published model
  with a warning if no persona is shared yet.
- The avatar's chat request path returns a real reply to `hello world`.

Exit code `0` = the avatar can chat; non-zero prints exactly which layer is down
and how to fix it.
