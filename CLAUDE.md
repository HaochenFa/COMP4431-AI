# Trailhead (COMP4431 group project)

A Hong Kong hiking pre-trip planning agent: a Python backend (agent harness + tools over official AFCD/HKO data) and an Expo iOS app (map + chat + voice). The spec is `docs/GroupProject.pdf`, the pitch is `docs/architecture-poster.html`, and run instructions are in `README.md`.
- Deliverables due 18/19 Nov 2026: a source zip + pptx.
- The live demo is in English, about 7 minutes, and runs on a projector (primary target: iOS Simulator + backend on localhost).
- Grading weights additional features, UI, innovation, and evaluation results.

## Layout

```
backend/app/llm/      Provider-neutral types (base.py) + adapters: anthropic_messages, openai_chat, openai_responses; registry.py reads config.yaml
backend/app/agent/    harness.py (tool loop, ask_user pause/resume), session.py (history, gate ledger, scenario), prompts/system.md
backend/app/tools/    hiking.py (trail/closure/weather/daylight/map tools), agentic.py (ask_user, load_skill, present_plan, refuse + gate), data.py (datasets, live feeds)
backend/app/skills/   Markdown SOPs loaded via load_skill; hike-safety.md is always injected into the system prompt
backend/app/schemas.py  Wire contract (TripPlan, Refusal, QuestionCard); mirrored by mobile/src/lib/types.ts
mobile/src/app/       Expo Router screens (index = map + chat sheet, settings = modal)
mobile/src/lib/       agent.tsx (WebSocket + reducer), settings.tsx, types.ts
data/                 Frozen dataset from scripts/ingest_afcd.py: trails.json, trails_raw.geojson, gpx/, snapshots/
```

## Commands

```bash
# backend (Python 3.12, uv)
cd backend && uv run pytest                                   # offline: scripted fake model, stubbed feeds
cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
LLM_PROFILE=gpt-responses uv run uvicorn app.main:app ...     # profiles live in backend/config.yaml
uv --project backend run python scripts/ingest_afcd.py        # refresh data/ (~1 min, scrapes hiking.gov.hk politely)

# mobile (Expo SDK 57)
cd mobile && npx expo run:ios        # development build; Expo Go is NOT enough (react-native-maps Google provider + speech recognition)
cd mobile && npx tsc --noEmit && npx expo lint
cd mobile && npx expo-doctor
```

Before calling a task done, run the relevant checks: `uv run pytest` for backend changes, and `tsc` + `expo lint` for mobile changes.

## Invariants: don't break these

- **Numbers come from tools, never the model.** `present_plan` is blocked until `check_closures` (every trail in the plan), `get_weather` and `get_daylight` have been called for that date. It is also blocked if km, hours or sunset differ from the tool data (`number_check` in `tools/agentic.py`). `refuse` is gated the same way, except for `OUT_OF_SCOPE`. Keep the gate in code, not only in the prompt.
- **The wire protocol is the contract between backend and app.** Any change to an event or schema must update both `backend/app/schemas.py` / the harness events and `mobile/src/lib/types.ts` + the reducer in `mobile/src/lib/agent.tsx`.
- **History is append-only and replayed natively.** Assistant turns keep the raw provider output in `Message.native[provider_key]`, and adapters replay it verbatim: Anthropic thinking blocks / signatures, Responses reasoning items (`store=False` + `include=["reasoning.encrypted_content"]`). Never edit or strip earlier turns. Drop a `tool_use` from history only when the turn was cut off (refusal / max_tokens) and the call won't run.
- **Tool arguments are validated with `jsonschema`** before a handler runs. Failures return `INVALID_ARGUMENTS` to the model and don't raise.
- **Every live feed goes through `cache.fetch_json`,** which falls back to `data/snapshots/<key>.json`, so the demo still works offline. Keep the snapshots committed.
- **Demo scenarios** (`session.scenario`: `clear`, `t8`, `rainstorm`, `thunderstorm`, `closure:<id>`) override only the weather/closure tools, and their results are labelled as overrides.

## Adding things

- **Tool:** register it in `tools/hiking.py` or `tools/agentic.py` with `box.register(name, description, schema_or_pydantic_model)` and return `ToolOutput(content, summary=...)`. Add a label in `mobile/src/constants/palette.ts` (`TOOL_LABEL`).
- **Provider:** implement `Provider.stream()` in `app/llm/` (yield `TextDelta`s, then exactly one `Completion`), add it to `_PROVIDERS` in `registry.py`, and add a conversion test in `backend/tests/test_llm_convert.py`.
- **Skill:** add `app/skills/<name>.md` with a `description:` front-matter line. It shows up in the `load_skill` enum automatically.
- For Anthropic/Claude API code, check current model IDs and SDK usage (via the `claude-api` skill) rather than memory. The default profile uses `claude-opus-5` with server-side `fallbacks: default`.

## Expo / React Native rules (condensed from Expo's AGENTS.md)

- **Expo changes every SDK release; don't trust memory.** Check the `expo` major version in `mobile/package.json` (currently 57), then read `https://docs.expo.dev/versions/v57.0.0/` or `https://docs.expo.dev/llms.txt` before touching Expo/RN APIs.
- **Add packages with `npx expo install <pkg>`** (SDK-compatible versions), never plain `npm install`. Use `npx expo install --fix` to repair version mismatches.
- **Routing:** every file in `src/app/` is a screen and `_layout.tsx` defines navigators. Non-route code goes in `src/components`, `src/lib` and `src/constants`. Import `router` / `Link` from `expo-router`. Use the `@/` path alias.
- **`ios/` and `android/` are generated** (Continuous Native Generation, gitignored). Never edit them. Configure native behaviour in `mobile/app.config.ts` and config plugins.
- Any library with native code requires rebuilding the dev build (`npx expo run:ios`).
- Prefer Expo modules over third-party ones.
- EAS (`npx eas-cli@latest build|submit|update`) is available for cloud builds, but the demo uses local builds.

## Gotchas

- **npm 11 installs:** the user's `~/.npmrc` sets `allow-scripts`, which npm 11 rejects in project installs. `mobile/.npmrc` neutralises it; keep that file.
- **Trail IDs:** AFCD layers disagree on zero padding (`cty_02` vs `cty_2`). Everything uses the normalised form (`norm_id`). One duplicate id in the layer is suffixed with its OBJECTID.
- **hiking.gov.hk pages render in Chinese** (the English toggle is JS-only). Official hours, stars and GPX links are scraped from the zh-tw page, and `description_zh` is Chinese.
- **HKO feeds:**
  - `fnd` starts tomorrow; today uses `flw`.
  - Warnings (`warnsum`) are "now" only.
  - Sunrise/sunset comes from `opendata.php?dataType=SRS&rformat=json`.
  - Dates beyond 9 days return a non-error "no forecast yet".
  - The Very Hot Weather Warning is reported but isn't an automatic no-go (hike-safety decides EXTREME_HEAT).
- **iOS 27 SDK requires the UIScene life cycle.** Expo 57's template doesn't adopt it, so `mobile/plugins/withSceneLifecycle.js` patches the generated AppDelegate + Info.plist to use Expo's `ExpoAppSceneDelegate` (mirrors the SDK 58 template). Remove the plugin when upgrading to SDK 58.
- **Local HTTP clients here go through a SOCKS proxy.** Use `websockets.connect(..., proxy=None)` in scripts that call localhost.
- **Secrets:** `backend/.env` holds the LLM keys and `mobile/.env` holds `GOOGLE_MAPS_IOS_KEY`. Both are gitignored; never commit keys. Model IDs for the OpenAI profiles in `config.yaml` are unverified.

## Status

Week 1 of the plan is done: harness, 3 adapters, tools, gate, question cards, skills, data ingest, Expo app with map, cards and voice.

Not built yet:
- RAG (`search_knowledge`, local embeddings)
- `get_transport` (Google Directions, server-side)
- Elevation profile (from `data/gpx/`)
- `eval/` (~40 scenarios, cross-provider table, no-tools baseline)
- User study

Not yet exercised against a real LLM or a simulator.
