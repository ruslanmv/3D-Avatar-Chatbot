# Standalone `avatar_control` — the documented fallback

**This directory contains documentation, not a server.** That is deliberate, and
this file says why, what the fallback is for, and exactly what it would have to
implement.

## What actually ships

The real `avatar_control` MCP server lives in HomePilot:

```
agentic/integrations/mcp/avatar_control/app.py     the nine tools
agentic/integrations/mcp/avatar_control_server.py  the uvicorn entry point
backend/app/avatar_director/control.py             the bridge that enforces §6.14
backend/app/agentic/sync_service.py                one entry: hp-avatar-control, port 9121
```

It is registered through the existing Context Forge registry alongside the other
`hp-*` servers, and it is the path anything with a HomePilot should use. It is
where the §6.14 safety table is enforced, and enforcing it in one place is the
reason it exists.

## What the fallback is for

One case: **an install with no HomePilot at all.** The client is a standalone
web app; it runs Tier 0 and Tier 1 entirely on the device and needs no server
for any of it. Someone running it that way, who wants an MCP client (a desktop
agent, an IDE assistant) to drive the avatar, has nowhere to point it — the
HomePilot server is not there to register.

A standalone Node server in this directory would fill that gap by talking to the
browser directly over a local WebSocket instead of through `/avatar/control`.

## What it would have to implement

The same nine tools, the same names, the same argument shapes — so that an MCP
client cannot tell which one it is talking to.
`agentic/integrations/mcp/avatar_control/app.py` in the HomePilot repository is
the contract; read `TOOLS` there.

Three rules it may not relax, because they are the reason the tools are safe
rather than convenient:

1. **Tools name intents, never clips.** `play_animation` takes a §6.2 emote name
   and the client's Tier-1 selector chooses the clip. A standalone server that
   accepted a clip id would be a second animation authority, and the whole point
   of Tier 1 is that there is one. (`config/behavior.config.json` →
   `emoteWhitelist` is the list.)
2. **The three capture tools need the client's own consent state.** Not a config
   flag, not a command-line switch: the live grant from
   `src/features/together/capture/ConsentMachine.js`. A server-side approval is
   not the same as the user having opted in on the device holding the camera,
   and a fallback that treated them as equivalent would be strictly worse than
   having no fallback.
3. **No live avatar is an error.** An MCP client told `{"ok": true}` while
   nothing happened has been lied to. Every refusal is named.

## Why it is not written yet

B17's acceptance is about the registered server: an MCP client running a
three-clip sequence on the live avatar, capture tools requiring consent, and
killing the server changing nothing locally. All three are met by the HomePilot
path and tested there (`backend/tests/avatar/test_avatar_control.py`, 40 tests).

A second full implementation with no consumer would be code nobody runs and
therefore code nobody notices breaking — and the _third_ acceptance criterion is
precisely that this layer is optional. Writing an unused optional layer to prove
a layer is optional is the wrong trade. When someone needs the standalone case,
this file is the specification for it.
