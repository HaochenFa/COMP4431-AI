# Trailhead (COMP4431 group project)

A Hong Kong hiking pre-trip planning agent: a Python backend (agent harness + tools over official AFCD/HKO data) and an Expo iOS app (map + chat + voice). The spec is `docs/GroupProject.pdf`, the pitch is `docs/architecture-poster.html`, and run instructions are in `README.md`.
- Deliverables due 18/19 Nov 2026: a source zip + pptx.
- The live demo is in English, about 7 minutes, and runs on a projector (primary target: iOS Simulator + backend on localhost).
- Grading weights additional features, UI, innovation, and evaluation results.

## Layout

```
backend/app/llm/      Provider-neutral types (base.py) + adapters: anthropic_messages, openai_chat, openai_responses; embeddings.py; registry.py reads config.yaml
backend/app/agent/    harness.py (tool loop, ask_user pause/resume), session.py (history, gate ledger, scenario), prompts/system.md
backend/app/tools/    hiking.py (trail/knowledge/closure/weather/daylight/map tools), agentic.py (ask_user, load_skill, present_plan, refuse + gate), data.py (datasets, GPX profiles, knowledge index, live feeds)
backend/app/skills/   Markdown SOPs loaded via load_skill; hike-safety.md is always injected into the system prompt
backend/app/schemas.py  Wire contract (TripPlan, Refusal, QuestionCard); mirrored by mobile/src/lib/types.ts
backend/eval/         cases.yaml (43 graded cases), run.py (runner + summary), baseline.py (no tools), driver.py (headless harness + persona), fixtures.py (frozen feeds), chat.py (terminal chat), trace.py
backend/app/rest.py   REST for the app: GET /trails, /trails/{id}, /conditions (HKO under the session's scenario); main.py serves data/photos at /photos
mobile/src/app/       Expo Router: (tabs)/ native tabs (index = Plan home, trails/ = browse) + root pushes: chat, plan/[id], trail/[id], map, settings (modal)
mobile/src/components/ ui/ (T, Icon, ListSection/ListRow, Chip, Button, StatRow, Glass, GlassButton, SearchField; logo.tsx = the mark), chat/ (activity row, question form, result cards, composer), trail/ (photo/route art, hero, elevation chart, map), plan/ (safety checks, timeline, sources)
mobile/src/constants/theme.ts  "Night trail" tokens (dark default, light "Day"), type scale, TOOL_META (label + SF Symbol + progress copy)
mobile/src/lib/       agent.tsx (WebSocket + reducer), recent.tsx (plans kept on device), trails.tsx (REST cache + conditions), settings.tsx (incl. appearance), warnings.ts (HKO warning → symbol + advice), voice.ts, types.ts
mobile/assets/        app.icon/ (Icon Composer bundle: iOS 26+ glass icon), images/icon.svg (source of the mark; icon.png and splash-icon.png are rendered from it)
data/                 Frozen dataset from scripts/ingest_afcd.py: trails.json, trails_raw.geojson, gpx/, snapshots/; knowledge.json from scripts/build_knowledge.py; photos/ (committed app assets) from scripts/fetch_photos.py
```

## Commands

```bash
# backend (Python 3.12, uv)
cd backend && uv run pytest                                   # offline: scripted fake model, stubbed feeds
cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
LLM_PROFILE=or-sonnet uv run uvicorn app.main:app ...         # profiles live in backend/config.yaml; or-* = OpenRouter
uv --project backend run python scripts/ingest_afcd.py        # refresh data/ (~1 min, scrapes hiking.gov.hk politely)
uv --project backend run python scripts/build_knowledge.py    # re-embed data/knowledge.json (needs the Ollama server, ~30 s)
uv --project backend run python scripts/fetch_photos.py       # AFCD trail photos -> data/photos (committed, ~50 MB; app falls back to route art)

# local models (Ollama; profiles `ollama` = qwen3:8b, `ollama-14b`; embeddings = bge-m3)
scripts/ollama_serve.sh                                       # port 11435, 32k context; leave the menu-bar app on 11434 alone
cd backend && uv run python -m eval.chat --profile ollama [--frozen] [--scenario t8]   # terminal chat
cd backend && uv run python -m eval.run --profile ollama [--cases id,category:weather] [--resume FILE]
cd backend && uv run python -m eval.baseline --profile ollama  # same cases, no tools
cd backend && uv run python -m eval.run --summarize eval/results/*.jsonl
cd backend && uv run python -m eval.trace traces/<session>.jsonl

# mobile (Expo SDK 57)
cd mobile && LANG=en_US.UTF-8 npx expo run:ios   # development build; Expo Go is NOT enough (maps + speech recognition). CocoaPods needs the UTF-8 locale
cd mobile && npx tsc --noEmit && npx expo lint
cd mobile && npx expo-doctor
```

Before calling a task done, run the relevant checks: `uv run pytest` for backend changes, and `tsc` + `expo lint` for mobile changes.

## Invariants: don't break these

- **Numbers come from tools, never the model.** `present_plan` is blocked until `check_closures` (every trail in the plan), `get_weather` and `get_daylight` have been called for that date. It is also blocked if what those checks returned rules the plan out (a no-go warning or a heavy-rain forecast for the date, or a closed trail: `safety_check`), or if km, hours or sunset differ from the tool data (`number_check` in `tools/agentic.py`). `refuse` is gated the same way, except for `OUT_OF_SCOPE`. Keep the gate in code, not only in the prompt.
- **The wire protocol is the contract between backend and app.** Any change to an event or schema must update both `backend/app/schemas.py` / the harness events and `mobile/src/lib/types.ts` + the reducer in `mobile/src/lib/agent.tsx`.
- **History is append-only and replayed natively.** Assistant turns keep the raw provider output in `Message.native[provider_key]`, and adapters replay it verbatim: Anthropic thinking blocks / signatures, Responses reasoning items (`store=False` + `include=["reasoning.encrypted_content"]`). Never edit or strip earlier turns. Drop a `tool_use` from history only when the turn was cut off (refusal / max_tokens) and the call won't run.
- **Tool arguments are validated with `jsonschema`** before a handler runs. Failures return `INVALID_ARGUMENTS` to the model and don't raise. Tools that take trail ids reject unknown ids (an unknown id must never read as "open").
- **Elevation and scenery are tool data too.** `ascent_m`/`max_m` come from the official GPX (`data.profiles()`, hysteresis-smoothed); `search_knowledge` returns official description passages to translate and cite, never figures.
- **Eval results must not depend on the day's weather.** `eval/` runs on `eval/fixtures.py` (synthetic forecast, seed closures and sunset) unless `--live`.
- **Every live feed goes through `cache.fetch_json`.** Live fetches are saved to the gitignored `data/snapshots/.live/`. On failure it falls back to that copy, then to the committed seed `data/snapshots/<key>.json`, so the demo still works offline. Keep the seeds committed (e.g. `hko_SRS_json_<year>.json` for every year the demo can plan into).
- **Demo scenarios** (`session.scenario`: `clear`, `t8`, `rainstorm`, `thunderstorm`, `closure:<id>`) override only the weather/closure tools, and their results are labelled as overrides.

## Adding things

- **Tool:** register it in `tools/hiking.py` or `tools/agentic.py` with `box.register(name, description, schema_or_pydantic_model)` and return `ToolOutput(content, summary=...)`. Pydantic schemas go through `flatten_schema` (inlined `$ref`s, nullable types instead of `anyOf`, no titles): Grok stopped mid-object and qwen copied `anyOf` into its arguments when given the nested form. Keep hand-written schemas flat too. Add an entry in `mobile/src/constants/theme.ts` (`TOOL_META`: label, SF Symbol, and the "Checking …" progress line; `hidden` for internal tools).
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

## UI rules

- **SF Symbols only** (`Icon` in `components/ui`); no emoji or Unicode glyphs as icons. Colour only through `useTheme()` tokens; no hex in screens.
- **Accent (lime) means go / primary action / primary route.** Caution and danger are for safety states; tab bar and headers stay monochrome.
- **Liquid Glass (`Glass`) is for controls and navigation** (composer, action bars, map buttons, `GlassButton`, `SearchField`), never for content cards.
- **Search uses `SearchField`, not `headerSearchBarOptions`**: the native header search is only glass once focused or scrolled, and the `integrated` placement squeezes it beside the toolbar buttons.
- **The mark** (two peaks, trail cut into the saddle) is one path shared by `components/ui/logo.tsx`, `assets/images/icon.svg` and `assets/app.icon`. Don't put it on a tinted tile.
- **The map is a mode**: `/map` or a still preview, never the background of a screen.

## Gotchas

- **npm 11 installs:** the user's `~/.npmrc` sets `allow-scripts`, which npm 11 rejects in project installs. `mobile/.npmrc` neutralises it; keep that file.
- **Trail IDs:** AFCD layers disagree on zero padding (`cty_02` vs `cty_2`). Everything uses the normalised form (`norm_id`). One duplicate id in the layer is suffixed with its OBJECTID.
- **hiking.gov.hk pages render in Chinese** (the English toggle is JS-only). Official hours, stars and GPX links are scraped from the zh-tw page, and `description_zh` is Chinese.
- **HKO feeds:**
  - `fnd` starts tomorrow; today uses `flw`.
  - Warnings (`warnsum`) are "now" only.
  - Sunrise/sunset comes from `opendata.php?dataType=SRS&rformat=json&year=YYYY`, one whole-year table per fetch.
  - Dates beyond 9 days return a non-error "no forecast yet".
  - The Very Hot Weather Warning is reported but isn't an automatic no-go (hike-safety decides EXTREME_HEAT).
- **iOS 27 SDK requires the UIScene life cycle.** Expo 57's template doesn't adopt it, so `mobile/plugins/withSceneLifecycle.js` patches the generated AppDelegate + Info.plist to use Expo's `ExpoAppSceneDelegate` (mirrors the SDK 58 template). Remove the plugin when upgrading to SDK 58.
- **Local HTTP clients here go through a SOCKS proxy.** Use `websockets.connect(..., proxy=None)` in scripts that call localhost.
- **Ollama:**
  - Its OpenAI-compatible endpoint ignores `num_ctx`, so the context length must be set on the server (`scripts/ollama_serve.sh`); otherwise the ~4k-token prompt plus history is silently truncated.
  - qwen3's thinking arrives in a separate `reasoning` field, which the chat adapter ignores.
  - qwen3 sometimes ends a turn with no text and no tool call, or types a tool name as text; the harness drops that turn and re-asks with a one-off note (`UNUSABLE_TURN_RETRIES`). Thinking is off in the `ollama` profile (`reasoning_effort: none`): ~3x faster and fewer empty turns; `ollama-think` keeps it on.
  - Per model call on an M3 Pro (18 GB): about 7–10 s for qwen3:8b with thinking off, 15–35 s with it on.
- **Secrets:** `backend/.env` holds the LLM keys (incl. `OPENROUTER_API_KEY`) and `mobile/.env` holds `GOOGLE_MAPS_IOS_KEY`. Both are gitignored; never commit keys. Model IDs for the OpenAI profiles in `config.yaml` are unverified.

## Status

Built so far:
- Week 1: harness, 3 adapters, tools, gate, question cards, skills, data ingest, Expo app with map, cards and voice.
- Week 2: `eval/` (43 cases, frozen feeds, no-tools baseline); the elevation profile (GPX → tools + plan-card chart); RAG `search_knowledge` (bge-m3 over description passages).
- Week 3: UI redesign ("Night trail"): native tabs (Plan home + Trails browse), full-screen chat with one-line agent activity, plan pages (AFCD photo hero, stats, safety checks, scrubbable elevation, map as a mode), SF Symbols only, Liquid Glass chrome, dark default with a light mode for projectors.
- Tested end to end on xAI Grok (`grok` = grok-4.6, `grok-4.7`, `grok-responses`; `XAI_API_KEY`, now low on credit), on Grok via OpenRouter (`or-grok`, the default in `.env`; `OPENROUTER_API_KEY`) and on local Ollama qwen3. The other `or-*` profiles (Sonnet 5, Gemini Flash, GPT-5.6, DeepSeek) are configured but not yet run through the eval. The Claude and GPT profiles are unit-tested only, until keys are added. The harness has to work for many models: prefer code-enforced rules and clear tool errors over prompt tweaks for one model.

Not built yet:
- `get_transport` (Google Directions, server-side), deferred.
- User study.
- Anthropic prompt caching: the system prompt is already cache-stable, since the clock time moved into user messages.
