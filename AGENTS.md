# TrailAI

TrailAI is the COMP4431 Hong Kong hiking planner. The FastAPI backend checks official AFCD trail and closure data and HKO weather and daylight. The Expo iOS app presents the agent's questions, plans, refusals, maps, and voice features. See `README.md` for setup and `docs/GroupProject.pdf` for the assignment. The live demo runs in English on an iOS Simulator with the backend on localhost and is designed for about seven minutes on a projector.

## Where to work

- `backend/app/agent/` owns the tool loop, `ask_user` pause and resume, conversation history, and the safety ledger. The system prompt lives in `agent/prompts/system.md`. The backend injects `app/skills/hike-safety.md` on every turn and loads other hiking procedures on demand.
- `backend/app/tools/` owns trail search, knowledge, closures, weather, daylight, and maps. `tools/agentic.py` gates plans and refusals. `backend/app/llm/` holds the Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses adapters and the embedding client. Consult `backend/config.yaml` for profiles and model IDs.
- `backend/app/main.py` serves `/ws/chat` and mounts photos. `rest.py` serves trail details, conditions, closures, and TTS. `mobile/src/lib/agent.tsx` handles the socket and reducer, `trails.tsx` handles REST data, and `recent.tsx` stores plans on device.
- `mobile/src/app/` contains Expo Router screens, including the Plan and Trails tabs. Shared UI, chat, trail, and plan components live under `mobile/src/components/`. Theme and tool activity metadata live in `mobile/src/constants/theme.ts`.
- `backend/eval/` holds the graded cases, frozen fixtures, harness runner, no-tools baseline, CLI chat, and trace reader. `scripts/` contains local development and data build scripts. `presentation/build/` contains the deck generators.

## Run and check changes

Run the checks for the areas you change. The backend suite uses a fake model and stubbed feeds and runs without credentials. For native UI or behavior changes, rebuild as needed and exercise the affected flow in the iOS Simulator.

```bash
scripts/dev.sh                               # backend :8000, Ollama :11435, Metro :8081, iOS Simulator
scripts/dev.sh --build --profile ollama      # rebuild the native app and choose a profile
(cd backend && uv run pytest)                # Python 3.12 and uv
(cd mobile && npx tsc --noEmit && npx expo lint)
```

`scripts/dev.sh` also accepts `--device` and `--no-ollama`. Maps and speech recognition require an iOS development build. For a standalone native build, run `LANG=en_US.UTF-8 npx expo run:ios` in `mobile/`. Keep the UTF-8 locale for CocoaPods.

Run these commands from `backend/` to exercise the agent. The evaluation defaults to frozen weather, closures, and sunset fixtures. Use `--live` on `eval.run` when specifically investigating live feeds.

```bash
uv run python -m eval.chat --profile ollama --frozen
uv run python -m eval.run --profile ollama --cases category:weather
uv run python -m eval.baseline --profile ollama
uv run python -m eval.run --summarize eval/results/*.jsonl
```

For standalone Ollama, use `scripts/ollama_serve.sh` from the repo root. It sets a 32k context on port 11435 and can run alongside the menu-bar server on 11434. Ollama's OpenAI-compatible endpoint ignores `num_ctx`. If the local SOCKS proxy intercepts a Python WebSocket client, pass `proxy=None` for localhost.

## Backend contracts

- Keep the safety gate in code. `present_plan` requires closure checks for both trail picks when present, plus weather and daylight for the plan date. It rejects closures, no-go warnings, heavy rain, unsupported trail figures and transit route numbers, and timelines that violate the walking-time or sunset constraints. The server fills in official trail details, citations, `weather_summary`, and `provisional`.
- `refuse` requires closure checks for named trails and weather evidence for the requested date. `AFTER_DARK` also requires daylight. A trail-specific code must name its trails. The `OUT_OF_SCOPE` exemption is limited to requests outside Hong Kong hiking and requires an empty trail list.
- Live safety checks must reject stale closure and warning feeds. Inside the HKO forecast window, missing usable forecast data without an applicable no-go warning returns an error and provides no new weather evidence. Dates beyond the forecast window can yield provisional plans. `Session.touch()` clears mutable safety checks after an hour of inactivity. Scenario changes clear those checks too. Both preserve sunset evidence.
- Route live JSON feeds through `backend/app/cache.py` and `fetch_json()`. It falls back to the gitignored `data/snapshots/.live/` and then committed seeds under `data/snapshots/`, with stale metadata. Preserve that metadata and keep the seeds, including HKO sunrise/sunset tables for the years the demo can plan into.
- Keep Hong Kong dates and HKO feed semantics intact. Use `flw` for today and `fnd` from tomorrow. Today's `flw.outlook` describes later days. Use `NO_GO_REACH_DAYS` for warning reach and `agentic.HEAVY_RAIN` for heavy-rain wording. Very Hot Weather is assessed through `hike-safety`.
- Resolve trail IDs through the existing `norm_id` conventions. Tool handlers must reject unknown IDs, especially in closure checks. Official GPX drives elevation stats, and `data.walking_hours()` flags estimates derived from official distance and climb. `search_knowledge` supplies official description passages for translation and citation. GTFS bus stops in `data/transport.json` are display-only REST data and stay outside the agent tools and gate.
- Declare tool argument schemas and preserve the harness's `jsonschema` validation before handlers run. Invalid calls return `INVALID_ARGUMENTS`. Register tools in `tools/hiking.py` or `tools/agentic.py` with `box.register(...)` and return `ToolOutput(content, summary=...)`. Keep schemas flat using `flatten_schema` for Pydantic inputs. Add a matching `TOOL_META` entry in `mobile/src/constants/theme.ts` and use `hidden` for internal tools.
- Preserve append-only history and raw provider output in `Message.native[provider_key]` for verbatim replay. This includes Anthropic thinking blocks and signatures, and Responses reasoning items with `store=False` and `reasoning.encrypted_content`. Drop a tool-use block only when the turn was cut off and the call will never run. New providers implement `Provider.stream()`, yield text deltas and exactly one `Completion`, register in `_PROVIDERS`, and add conversion coverage in `backend/tests/test_llm_convert.py`. Check provider documentation against the configured adapter and SDK when changing an API integration.
- Add runtime skills to `backend/app/skills/` with `description:` front matter so `load_skill` can discover them.

## Backend and app boundary

- For a payload or event change, update `backend/app/schemas.py` or the server event producers together with `mobile/src/lib/types.ts` and the reducer in `mobile/src/lib/agent.tsx`. Keep session ID validation and trace file containment in `backend/app/agent/session.py`.
- Reconnects must preserve pending question cards and replay buffered events after `hello`. Retain an event when replay fails, and keep `hello.running` and `hello.has_history` consistent so the app can recover an in-flight turn or start a fresh chat when appropriate.
- Demo settings are persisted by the app and re-sent on `hello`. Keep weather and closure overrides explicit and propagate `scenario` on plan and refusal cards for the Demo label. Use `clear` to exercise offline planning when the live forecast is unavailable.
- Keep `/tts` support for `HEAD` and byte ranges (`206` and `416`). AVPlayer probes the clip with `Range: bytes=0-1`. Kokoro loads in the background, and the app uses an installed iOS voice while `/tts` is unavailable. Use `uv run python -m app.tts` from `backend/` to check or fetch the gitignored model in `data/tts/`.

## Expo and iOS conventions

- Check the Expo major in `mobile/package.json` and consult the matching Expo SDK documentation before changing native APIs. Prefer Expo modules and add dependencies with `npx expo install <pkg>`. Keep `mobile/.npmrc` for the npm 11 `allow-scripts` workaround. [Expo SDK 57 docs](https://docs.expo.dev/versions/v57.0.0/)
- Use Expo Router and `@/` imports. Keep screen and layout files in `src/app/`. Apply native changes in `mobile/app.config.ts` or a config plugin and regenerate the native projects. Rebuild after native dependencies, config, or patches change.
- Use the shared `Icon` component with SF Symbols and `useTheme()` tokens for colors. Use `accent` for primary fills and route lines, `routeCase` for the route outline, `onAccent` for text on accent fills, and `accentInk` for colored text and icons. Reserve caution and danger colors for safety states. Keep tab bars and headers monochrome and verify both Night and Day appearances.
- Reserve Liquid Glass for navigation and controls. Use the map as a dedicated screen or preview. Keep the shared logo path in sync across `logo.tsx`, `assets/images/icon.svg`, and `assets/app.icon` when changing the mark.
- Preserve `Stack.SearchBar` with `placement="integratedButton"` and `allowToolbarIntegration={false}`. Trails search overlays results and keeps the underlying list's scroll position. The `react-native-screens` patch restores cancel and clear events when the native glass X dismisses search. Recheck the patch on upgrades. The Trails map uses a still `ScrollView` so the native header can apply its scroll-edge effect.
- Chat uses a `ScrollView` so new result cards scroll fully into view and pads the composer directly from the keyboard height. Move `GlassView` with transforms and fade its siblings to avoid rendering failures with entering or opacity animations.
- Keep `withSceneLifecycle.js` and `ios.usePrecompiledModules: false` while the pinned Expo and Xcode combination requires them. Verify launch before removing either workaround. On Xcode 27, `scripts/dev.sh` opens Device Hub. If a native crash leaves later launches failing with a missing dyld cache, shut down and reboot that simulator with `xcrun simctl`.

## Data, decks, and credentials

- Regenerate frozen trail data and GPX with `scripts/ingest_afcd.py`, knowledge with `scripts/build_knowledge.py`, bus stops with `scripts/build_transport.py`, and committed photos with `scripts/fetch_photos.py`. Run these from the repo root with `uv --project backend run python`. Knowledge generation needs local embeddings. AFCD's official times, stars, GPX links, and descriptions are scraped from the Chinese page.
- Edit the deck generator and rebuild so edits survive regeneration. From `presentation/build/`, `npm run build` writes `TrailAI.pptx`, `node build_revised_deck.js` writes `TrailAI_Revised.pptx`, and `python3 stats.py` refreshes `stats.json` from `backend/eval/results/`.
- Keep provider credentials in the gitignored `backend/.env` and the optional Google Maps iOS key in `mobile/.env`. Use `/health` to check the provider and model the backend has loaded. Keep secrets out of commits and command output.
