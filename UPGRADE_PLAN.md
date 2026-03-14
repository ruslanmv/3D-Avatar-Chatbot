# OllaBridge Gateway — Complete Additive-Only Upgrade Plan

## Design Goal

Keep all existing working systems intact. Add the missing bridge layers, fix
today's visible bugs first, then add rich media and VR-native behavior — without
breaking web, desktop, or OpenAI compatibility.

---

## Final Target Architecture

### Responsibility Split

| Layer                 | Owns                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **HomePilot**         | Persona meaning, Memory V2, RAG, persona prompt construction, image generation/persona images, canonical enrichment data for media/directives |
| **OllaBridge**        | Client detection, capability negotiation, session bridging, response normalization, media proxy/passthrough, delivery shaping per client      |
| **3D-Avatar-Chatbot** | VR rendering, text panel, image/media panel, avatar reaction to directives, voice playback, persona bootstrap consumption                     |

---

## Verified Current State (What Exists Today)

| Component          | HomePilot                                                                   | OllaBridge                                               | 3D-Avatar                                                   |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| Persona publishing | `shared_api.enabled`, alias, featured_slot                                  | Trusts HP `/v1/models`                                   | Fetches model list                                          |
| Persona context    | `build_persona_context()` 300+ lines in `projects.py:446`                   | `/v1/persona/context/{model}` endpoint                   | `PersonaContextBridge.js` with sessionStorage cache         |
| Memory bridge      | Source: `/persona/memory` endpoint                                          | `memory_bridge.py` read-only, 60s cache                  | Receives via `x_persona_context`                            |
| Consumer nodes     | N/A                                                                         | `ConsumerNode` with kind=avatar, auto-created on pairing | Sends pair token                                            |
| Pairing flow       | N/A                                                                         | code→token→device→consumer node                          | Stores `pair_token` in localStorage                         |
| Response parsing   | `[show:Label]` resolved in `run_project_chat()` web flow only               | Passes content through as-is                             | Extracts `.choices[0].message.content`, no tag stripping    |
| Voice/TTS          | Not involved                                                                | Passes voice config in PersonaContext                    | SpeechSynthesis + persona voice overrides                   |
| Capability headers | Not read                                                                    | Not read                                                 | Only sends `X-Include-Persona-Context`                      |
| Media delivery     | `[show:Label]` → URL resolved in web UI path only (`projects.py:1344-1396`) | No media proxy                                           | Text-only chat panel                                        |
| Avatar directives  | Not emitted                                                                 | Not translated                                           | `emotional_base` → animation mode from persona context only |

### Critical Gap: The `[show:]` Pipeline

The compat endpoint (`openai_compat_endpoint.py:241-301`) calls
`_chat_with_persona_project()` which calls `llm_chat()` directly — it **never
runs the tag resolution pipeline** that exists in `run_project_chat()`
(`projects.py:1344-1396`). So `[show:]` tags arrive at the client raw.

---

## Three Bugs Visible Right Now

All three trace to missing response normalization in OllaBridge.

| Bug                                                   | Root Cause                                                                                                                               | Location                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `{"type":"final","text":"..."}` displayed as raw JSON | HomePilot agent loop returns wrapped JSON; OllaBridge passes through; 3D-Avatar shows raw string                                         | `main.py:397-406` — no unwrapping    |
| `[show:Default Look]` displayed as text               | HomePilot system prompt tells LLM to emit tags; compat endpoint doesn't resolve them; OllaBridge doesn't strip them                      | OllaBridge — no tag filtering        |
| "NEXUS" instead of persona name                       | OPTIONS 400 blocks persona context fetch; falls back to hardcoded `"You are a helpful AI assistant named Nexus"` at `LLMManager.js:1024` | OllaBridge CORS / 3D-Avatar fallback |

---

## Phased Implementation Plan

### Phase 1A — Immediate Visible Bug Fix

**Goal:** Make VR text always clean, even before rich media exists. **Repo:**
OllaBridge **Files to touch:**

- `ollabridge/src/ollabridge/api/main.py` (chat_completions handler, lines
  397-406)
- optionally `ollabridge/src/ollabridge/connectors/homepilot.py` (lines 85-105)

**Additive changes:**

Add a response normalization function in the chat response path that:

1. **Unwraps legacy JSON strings** like `{"type":"final","text":"..."}`:

    ```python
    import json, re

    _SHOW_TAG_RE = re.compile(r'\[show:[^\]]*\]', re.IGNORECASE)

    def _normalize_content(raw_content: str, client_type: str | None = None) -> str:
        """Strip delivery artifacts from response text."""
        text = raw_content

        # 1. Unwrap {"type":"final","text":"..."} wrapper
        if text.lstrip().startswith('{'):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict) and 'text' in parsed:
                    text = parsed['text']
            except (json.JSONDecodeError, KeyError):
                pass

        # 2. Strip [show:Label] tags (VR can't render them yet)
        text = _SHOW_TAG_RE.sub('', text).strip()

        # 3. Collapse excess whitespace left by stripping
        text = re.sub(r'\n{3,}', '\n\n', text)

        return text
    ```

2. Apply in `chat_completions()` after line 397, before building the response
   dict:
    ```python
    client_type = request.headers.get("X-Client-Type")
    content = _normalize_content(content, client_type)
    ```

**Behavior:**

| Input                                      | Output            |
| ------------------------------------------ | ----------------- |
| `{"type":"final","text":"That's lovely."}` | `That's lovely.`  |
| `Here's my look! [show:Default Look]`      | `Here's my look!` |
| Normal text                                | Unchanged         |

**Impact:** 0 lines changed in HomePilot, 0 in 3D-Avatar. Fixes broken UX
immediately.

---

### Phase 1B — Client Identification

**Goal:** Let OllaBridge know what kind of client is calling.

**Repo: 3D-Avatar-Chatbot** **File:** `src/LLMManager.js` (in
`_chatOllaBridge()`, around line 500)

Add headers on OllaBridge calls:

```javascript
headers['X-Client-Type'] = 'vr-chatbot';
headers['X-Client-Capabilities'] =
    'text_chat,voice_output,image_panel,avatar_pose,avatar_emotion';
```

Keep the current request body unchanged.

**Repo: OllaBridge** **Files:**

- `ollabridge/src/ollabridge/api/main.py`
- optionally `ollabridge/src/ollabridge/core/consumer_registry.py`

Read those headers and:

- Apply response filtering for VR clients (already set up in Phase 1A)
- Optionally persist `client_type` and `capabilities` on the consumer node for
  future use

**Impact:** ~5 lines in 3D-Avatar, ~15 lines in OllaBridge.

---

### Phase 2 — Bridge Session Persistence

**Goal:** Keep conversation continuity across Quest launches / page reloads.

**Repo:** OllaBridge **New module:**
`ollabridge/src/ollabridge/core/session_bridge.py` **Files to touch:**

- `ollabridge/src/ollabridge/api/main.py`
- optionally `ollabridge/src/ollabridge/core/consumer_registry.py`

**Additive changes:**

Create a lightweight session mapping layer:

```python
@dataclass
class BridgeSession:
    device_id: str
    model: str
    bridge_session_id: str          # OllaBridge-scoped ID
    homepilot_conversation_id: str  # Forwarded to HomePilot
    last_active: float              # timestamp
```

**Storage:** SQLite table `bridge_sessions` (using existing `ollabridge/db/`
infrastructure) or a simple JSON file.

**Request flow:**

1. Resolve `device_id` from pair token
2. Resolve `model` from request
3. Look up prior `homepilot_conversation_id` for this device+model pair
4. If found and not expired, reuse it (send as header or query param to
   HomePilot)
5. If not found, start fresh conversation and store the mapping

**Critical constraint:** Do NOT create a second memory database in OllaBridge.
HomePilot already has persona sessions and Memory V2. OllaBridge only reconnects
the VR device to the same HomePilot conversation/session lineage.

**Impact:** ~100 lines in OllaBridge, 0 in HomePilot (HomePilot already accepts
conversation IDs).

---

### Phase 3 — Canonical Enriched Response from HomePilot

**Goal:** Keep OpenAI compatibility while enabling rich bridge payloads.

**Repo:** HomePilot **Files to touch:**

- `backend/app/openai_compat_endpoint.py` (primary —
  `_chat_with_persona_project()` at line 241)
- `backend/app/projects.py` (supporting — reuse existing `[show:]` resolution
  from lines 1344-1396)
- `backend/app/media_resolver.py` (already exists — `_build_label_index()` at
  line 88, `_lookup_label()` at line 203)

**Additive changes:**

Keep current `/v1/chat/completions` response compatible. Add optional enriched
mode triggered by:

- `X-Client-Type` header present, OR
- `?include_media=true` query parameter

When enabled, return extra fields alongside normal text:

```json
{
    "id": "...",
    "object": "chat.completion",
    "choices": [
        {
            "message": {
                "role": "assistant",
                "content": "Here's my photo!"
            }
        }
    ],
    "x_attachments": [
        {
            "type": "image",
            "name": "Default Look",
            "url": "/files/projects/.../default-look.png",
            "mime": "image/png"
        }
    ],
    "x_directives": {
        "emotion": "happy",
        "pose": "presenting"
    }
}
```

**Implementation approach:**

Port the existing tag-resolution logic from `run_project_chat()` (lines
1344-1396) into the compat flow:

1. Parse `[show:Label]` from LLM response text
2. Call `_build_label_index()` and `_lookup_label()` from `media_resolver.py`
3. Strip tags from returned `content` text
4. Place resolved results into `x_attachments` array

Do NOT redesign the wardrobe/photo system. Reuse what exists.

**Impact:** ~80 lines in HomePilot (additive to `openai_compat_endpoint.py`).
Zero changes to web UI flow.

---

### Phase 4 — Media Proxy Through OllaBridge

**Goal:** Make media safe and stable for VR clients. VR client should not need
to know HomePilot internal file-serving patterns.

**Repo:** OllaBridge **New module (optional):**
`ollabridge/src/ollabridge/connectors/media_proxy.py` **Files to touch:**
`ollabridge/src/ollabridge/api/main.py`

**Additive changes:**

Add a simple media passthrough/proxy route:

```
GET /v1/media/{path:path}
```

This proxies HomePilot media from `/files/...` or `/v1/assets/...` and
re-exposes it as an OllaBridge-relative URL.

**Response URL rewriting in chat_completions:**

Transform HomePilot attachment URLs to bridge-safe URLs:

```json
{
    "type": "image",
    "name": "Default Look",
    "delivery": "url",
    "url": "/v1/media/proxy/abc123",
    "mime": "image/png"
}
```

**Critical constraint:** Do NOT create a permanent media database in OllaBridge.
Proxy or rewrite only.

**Impact:** ~50 lines in OllaBridge.

---

### Phase 5 — Structured Response Consumption in 3D-Avatar-Chatbot

**Goal:** Move from text-only replies to multimodal replies without breaking
current chat.

**Repo:** 3D-Avatar-Chatbot

#### 5.1 — New BridgeResponseAdapter

**New file:** `src/BridgeResponseAdapter.js`

A normalizer that accepts any of:

- Plain string
- Standard OpenAI response
- Enriched OllaBridge payload
- Legacy wrapped JSON text

And returns one internal shape:

```javascript
{
  text: "Here's my photo!",
  attachments: [],
  avatar_directives: {},
  persona_context: null,
  meta: {}
}
```

This becomes the **single parsing layer** for the VR client.

#### 5.2 — Extend LLMManager.js

Keep the old text path working. Add structured response support:

- Add `sendMessageStructured()` or a `structured: true` option
- When calling OllaBridge: send `X-Client-Type`, `X-Client-Capabilities` headers
- Pass response through `BridgeResponseAdapter`
- Return normalized objects instead of only strings for VR-aware callers
- Do NOT break legacy callers that still expect text

#### 5.3 — Extend VRChatIntegration.js

Change `handleBotResponse()` to accept either string or normalized response
object. Split behavior into:

- Text rendering
- TTS text extraction
- Attachment rendering
- Directive application

#### 5.4 — Extend VRChatPanel.js

Keep current message model `{ role, text }` working via existing
`appendMessage(role, text)`.

Add parallel method `appendRichMessage(message)` with richer internal structure:

```javascript
{
  role: "bot",
  text: "Here's my photo!",
  attachments: [
    { type: "image", name: "Default Look", delivery: "url", url: "/v1/media/proxy/abc123" }
  ],
  directives: { emotion: "happy", pose: "presenting" }
}
```

#### 5.5 — Add Image/Media Rendering

**In VRChatPanel.js:** Render image attachments under message text as thumbnail
card or inline image region.

**New file:** `src/gltf-viewer/VRMediaPanel.js` — A lightweight floating plane:

- Hidden by default
- Opens when an image attachment exists
- Shows current attachment
- Optionally enlarges the selected image
- Start simple: one image at a time

#### 5.6 — Desktop Attachment Rendering

**Files:** `src/main.js`, `js/chat-manager.js`

Add support for image attachments on desktop/web too, so debugging is easier and
desktop behavior aligns with VR.

**Impact:** ~300 lines across 3D-Avatar-Chatbot. All additive.

---

### Phase 6 — Per-Message Avatar Directives

**Goal:** Move from static persona defaults to turn-by-turn avatar reactions.

**Repo:** 3D-Avatar-Chatbot **Files to touch:**

- `src/gltf-viewer/VRChatIntegration.js`
- Existing animation/expression handlers
- `src/PersonaContextBridge.js` for defaults lookup

**Additive changes:**

Apply optional message directives returned from OllaBridge/HomePilot:

- `emotion` (happy, sad, thinking, excited, calm, etc.)
- `pose` (presenting, waving, crossed_arms, etc.)
- `gesture` (nod, shake_head, point, etc.)

**Pattern:**

- Persona context sets **default** voice/expression style
- Message directives **temporarily override** for the current turn
- If absent, fall back to current behavior (never mandatory)

Example directive:

```json
{
    "x_avatar_directives": {
        "emotion": "happy",
        "pose": "presenting"
    }
}
```

**Impact:** ~60 lines. Fully optional/graceful.

---

### Phase 7 — Expand Persona Bootstrap

**Goal:** Improve VR pre-chat setup with richer persona metadata.

**Repo: OllaBridge** **Files:**
`ollabridge/src/ollabridge/connectors/memory_bridge.py`,
`ollabridge/src/ollabridge/api/main.py`

Extend the existing `/v1/persona/context/{model}` response with VR-safe
metadata:

- `display_name`
- `short_bio`
- `voice_hints`
- `supported_directives`
- `default_avatar_mood`
- `image_support` flag
- Default appearance/media preview reference

**Repo: 3D-Avatar-Chatbot** **File:** `src/PersonaContextBridge.js`

Add helpers for:

- Image support flags
- Preferred modality
- Render hints
- Supported directive list

Do NOT replace the current bridge. Expand it only.

---

### Phase 8 — Client-Aware Prompting

**Goal:** Improve behavior quality once the delivery path is stable. This is
phase-last because stable rendering matters more than prompt tuning.

**Repo:** HomePilot **Files:** `backend/app/projects.py`
(`build_persona_context()` at line 446), optionally
`backend/app/openai_compat_endpoint.py`

**Additive changes:**

Read optional client type/capability metadata and apply lightweight prompt
shaping:

For VR clients:

- Reduce or omit full wardrobe/gallery browsing instructions
- Avoid excessive `[show:]`-style phrasing
- Prefer compact image-friendly language
- Optionally encourage emotion/pose style cues

This should be a **conditional branch**, not a replacement of the existing
persona prompt builder.

---

## Recommended API Contracts

### 1. Chat Request (remains OpenAI-compatible)

```
POST /v1/chat/completions

Headers:
  Authorization: Bearer <token>
  X-Client-Type: vr-chatbot
  X-Client-Capabilities: text_chat,voice_output,image_panel,avatar_pose,avatar_emotion
  X-Include-Persona-Context: true

Body: standard OpenAI chat completion request
```

### 2. Enriched Response from HomePilot (Phase 3)

```json
{
    "choices": [
        { "message": { "role": "assistant", "content": "Here's my photo!" } }
    ],
    "x_attachments": [
        {
            "type": "image",
            "name": "Default Look",
            "url": "/files/projects/.../default-look.png"
        }
    ],
    "x_directives": { "emotion": "happy", "pose": "presenting" }
}
```

### 3. Normalized OllaBridge Response to VR (Phase 4-5)

```json
{
    "choices": [
        { "message": { "role": "assistant", "content": "Here's my photo!" } }
    ],
    "x_attachments": [
        {
            "type": "image",
            "name": "Default Look",
            "delivery": "url",
            "url": "/v1/media/proxy/abc123",
            "mime": "image/png"
        }
    ],
    "x_avatar_directives": { "emotion": "happy", "pose": "presenting" },
    "x_persona_context": { "...": "..." }
}
```

Legacy text clients ignore the `x_*` fields. VR clients consume them.

---

## Best Practices

### Compatibility First

- Do NOT break existing `/v1/chat/completions`, `/v1/models`, web UI, or
  desktop/VR text flow
- All enriched behavior is optional and additive
- `x_*` prefix fields are safely ignored by any OpenAI-compatible client

### Normalize Once Per Layer

- **HomePilot:** semantic enrichment (resolve tags → structured attachments)
- **OllaBridge:** client delivery shaping (normalize text, rewrite URLs, add
  proxy paths)
- **3D-Avatar:** rendering normalization (parse into internal shape, render
  appropriately)
- Do NOT duplicate the same logic in all three repos

### URL Media Delivery First

- Use URL delivery (not Base64) as the default
- Smaller payloads, easier caching, better logs, better streaming compatibility,
  easier VR rendering
- Base64 as optional fallback only

### Graceful Fallback Everywhere

- No attachments? → render text only
- No directives? → use current avatar defaults
- Persona context fetch fails? → use cached or fall back to current behavior, no
  raw error leakage

---

## Suggested Rollout Order

| Release       | Scope                  | What Ships                                                                                                        |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Release 1** | OllaBridge only        | Response normalization, strip `[show:]`, unwrap JSON, client-type header reading. **Fixes current visible bugs.** |
| **Release 2** | OllaBridge + 3D-Avatar | Structured response adapter, capability headers, session bridge, VR structured consumption                        |
| **Release 3** | HomePilot + OllaBridge | Enriched compat response with `x_attachments`, media proxy/passthrough                                            |
| **Release 4** | 3D-Avatar              | Image/media panel, desktop attachment rendering, avatar directives                                                |
| **Release 5** | HomePilot              | Client-aware prompt shaping for VR                                                                                |

---

## File Change Summary (All Repos)

### HomePilot

| File                                    | Phase | Change Type                                                                      |
| --------------------------------------- | ----- | -------------------------------------------------------------------------------- |
| `backend/app/openai_compat_endpoint.py` | 3     | Add enriched mode, tag resolution in compat flow, `x_attachments`/`x_directives` |
| `backend/app/projects.py`               | 3, 8  | Extract tag resolution helper; add client-aware prompt branch                    |
| `backend/app/media_resolver.py`         | 3     | Already exists — reuse `_build_label_index()`, `_lookup_label()`                 |

### OllaBridge

| File                                         | Phase           | Change Type                                                                                         |
| -------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| `src/ollabridge/api/main.py`                 | 1A, 1B, 2, 4, 7 | Response normalization, client headers, session lookup, media proxy route, expanded persona context |
| `src/ollabridge/core/session_bridge.py`      | 2               | **New** — lightweight session mapping                                                               |
| `src/ollabridge/connectors/media_proxy.py`   | 4               | **New (optional)** — media passthrough                                                              |
| `src/ollabridge/connectors/homepilot.py`     | 1A              | Optional normalization at connector level                                                           |
| `src/ollabridge/core/consumer_registry.py`   | 1B              | Optional client_type/capabilities on consumer node                                                  |
| `src/ollabridge/connectors/memory_bridge.py` | 7               | Expanded persona context fields                                                                     |

### 3D-Avatar-Chatbot

| File                                   | Phase    | Change Type                                         |
| -------------------------------------- | -------- | --------------------------------------------------- |
| `src/BridgeResponseAdapter.js`         | 5.1      | **New** — response normalization adapter            |
| `src/gltf-viewer/VRMediaPanel.js`      | 5.5      | **New** — VR image display panel                    |
| `src/LLMManager.js`                    | 1B, 5.2  | Add capability headers, structured response support |
| `src/gltf-viewer/VRChatIntegration.js` | 5.3, 6   | Accept structured responses, apply directives       |
| `src/gltf-viewer/VRChatPanel.js`       | 5.4, 5.5 | Rich message support, image rendering               |
| `src/PersonaContextBridge.js`          | 7        | Expanded helpers for new persona metadata           |
| `src/main.js`                          | 5.6      | Desktop attachment rendering                        |
| `js/chat-manager.js`                   | 5.6      | Desktop attachment support                          |

### Zero Changes To:

- Built-in personality definitions or registry
- OllaBridge router logic (beyond additive normalization)
- OllaBridge model discovery logic
- 3D Avatar proxy server
- Any configuration files or env vars
- HomePilot web UI chat flow
- HomePilot Memory V2 engine
- HomePilot asset registry schema

---

## One-Sentence Summary

Keep HomePilot as the semantic source, extend OllaBridge with
normalization/session/media adaptation, and extend 3D-Avatar-Chatbot from
text-only rendering to structured multimodal rendering, in phased additive
releases that preserve all current behavior.
