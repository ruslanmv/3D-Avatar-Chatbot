# Focus, rebuilt as understanding something

## What it replaced

Focus was body doubling: a pomodoro clock, structural silence, two mirror gestures, and a
`focus_streak` row on completion.

The silence was the best-engineered part — a profile overlay with `budgetPerSession: 0`, so she
*cannot* speak rather than remembering not to. Everything around it was thin:

- the clock lived behind a panel you close in order to work
- the streak was written on every block and **read by nothing** (checked, not assumed) — the
  spec called it "the first place the user sees her memory", and the user never saw it
- Focus left no trace in the chat, start or end
- what remained was a pomodoro timer worse than the one on your phone

## What it is now

Name a topic. She reads up on it **first**, then works through it in questions.

```
Focus  →  "What shall we understand today?"
              ↓  topic
          researching   she reads before saying anything about it
              ↓
          calibrating   "what do you already know?"
              ↓
          learning      she asks → you answer → she responds to YOUR answer
              ↓
          checking      "explain it back in your own words"
              ↓
          summary       what held · what didn't · one thing to return to
```

`researching` precedes speech because a model asked to teach without material teaches anyway,
fluently and sometimes wrongly. `calibrating` precedes `learning` because asking what somebody
knows both activates it and stops her explaining it again. `learning` is questions rather than
exposition because being asked to recall beats being told twice. `checking` is the Feynman step
— explaining in your own words is the one exercise recognition cannot fake.

**Body doubling survives as a branch, not a deletion.** *"Just sit with me"* still gets the
silent block, unchanged.

## Wikipedia first, the web only when it is genuinely not there

Not "ask both and merge":

- an encyclopedia article is written to explain a topic; a search snippet is written to make you
  click — blending them dilutes the first on every topic rather than only the ones that need it
- everything read ends up in a prompt, and the open web is a far dirtier surface than an
  edit-reviewed encyclopedia
- Wikipedia is free and keyless; a search API is neither

"Not there" means four different things, and they are reported separately: **nothing found**,
**too thin to teach from** (a two-sentence stub is a citation, not a lesson), **unreachable**,
and **rate limited**. All escalate; only one of them is worth saying out loud.

**Wikipedia needs no key**, so a study session works on a fresh deployment with nothing
configured. Web search is an upgrade: set `BRAVE_SEARCH_API_KEY` or `SERPER_API_KEY` in Vercel
and `/api/research/search` uses it, server-side, never in the browser.

## Two things found by running it

**Wikimedia rate-limits unidentified clients.** Three topics in a row returned
`429 You are making too many requests`, which the code reported as "could not reach Wikipedia".
A browser cannot set `User-Agent`; `Api-User-Agent` is the documented path, and 429 is now its
own reason because "ask again shortly" and "could not reach" have different fixes.

**Search is throttled far harder than reads.** With the sandbox IP limited, `page/summary`
answered 200 while every search returned 429. Most study topics are *already* article titles, so
it now **reads first and searches only on a miss** — one cheap call instead of two on the common
path, and the throttled endpoint reached only for genuinely ambiguous topics like "mercury",
which comes back as a disambiguation page and is rejected.

## Against the two failure modes of AI tutors

**Making things up.** Sources are fenced and labelled as data with the instruction above them;
she is told to say the source does not cover something rather than fill the gap. Source text is
capped and stripped of fence markers at the edge, so it cannot forge a boundary — a test drives
a source containing the fence markers and asserts exactly one of each survives.

**Agreeing with everything.** The instruction spends more words on wrong answers than on
anything else: name the part that holds and the part that does not, re-ask rather than supply
the answer, and *never* "Great!" to something that was not. A tutor that approves of every answer
teaches nothing, and the learner leaves believing they understood.

## What she remembers

`<studied concept="…" verdict="solid|shaky">` — one tag, stripped before display, recorded in the
session. Verdicts, not scores: a percentage invites the scoreboard this must not become.

That builds the closing summary from what actually happened rather than her recollection of it,
and the next session's opening line:

> *"Last time — quantum entanglement. Measurement was the shaky part. Pick that up, or something
> new?"*

Local, capped at 20 sessions, one entry per topic so a second session supersedes the first.
This is the thing a plain chat structurally cannot do, and the only part of the feature a general
chatbot cannot copy.

## Web search in Settings, and looking things up mid-conversation (S4)

**Settings → Discovery & Media**, under the YouTube key: a provider dropdown (Brave or Serper)
and a key box. The box stays hidden until a provider is chosen, because an empty field labelled
"API key" under a dropdown reading *"use this site's setup"* invites somebody to fill in
something that will be ignored.

**Whose key wins is the user's** — the rule D13 settled for YouTube. Somebody who typed a key
meant to use it; silently preferring the deployment's would make the field decorative. With no
key of their own the site's route answers and they never learn keys exist.

A user key travels **browser → their own deployment's proxy → the API**, because neither Brave
nor Serper sends CORS headers. That is the path an OpenAI or Anthropic key already takes through
the same allowlist, to the same deployment already trusted with those, so it adds no new trust.
The deployment's *own* key never comes this way — it stays server-side in
`api/research/search.js`. A user key that fails falls back to the site's route rather than
failing outright: the site may still have one, and the person asked a question either way.

### Looking things up

Together now tells her she can search: `<lookup>search terms</lookup>` for anything she cannot
know from training — today's news, the weather, whether something has happened — and *not* for
things she already knows, which wastes a second, or for opinions.

It runs in two passes, which is what a tool call is. The first reply says "let me check" and
carries the tag; the app strips it, searches, and asks again with the results in the prompt. The
holding sentence stays on screen in between, because a search takes a second and a silent pause
reads as the app having stopped.

**The app never pastes snippets into the chat.** Results are held for the next prompt and
cleared once used, so they cannot answer a later question. Printing them would make this a
search engine with an avatar; the thing being built is somebody who read them and can be asked
a follow-up.

The honesty rules are the point: answer *from* the results, name where it came from, say when
they disagree, and say when they do not settle the question rather than picking the most
confident-sounding one. **A wrong answer assembled from three headlines is worse than admitting
it is unclear, because from the outside they look the same.**

Why a tag rather than a pattern: the app cannot tell from the words alone. *"What is the
weather"* plainly needs looking up; *"is that still true?"* depends entirely on what came
before. A pattern list would be wrong in both directions, so the model — which has the
conversation — decides.

---

## Verified

Live against Wikipedia: `photosynthesis` and `quantum entanglement` both read and sufficient,
nonsense correctly `not-in-wikipedia`. Eight mutants across both layers, all killed. 110 suites,
3,090 tests.

## Not done here

The topic answer is routed through the DOM interceptor, so **spoken** answers still bypass it —
the same known gap as the media commands. The session has no clock, deliberately; if a timer
turns out to be wanted it belongs beside the study loop, not inside it.
