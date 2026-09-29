# Trailhead: HK Country Park Planner

COMP4431 group project (2026/27): a domain-specific chatbot for planning Hong Kong hikes.

| Student ID | Name |
|---|---|
| _TODO_ | _TODO_ |
| _TODO_ | _TODO_ |

Trailhead is a pre-trip feasibility agent. You describe a hike loosely ("Saturday, half day, sea view, it rained last night"). It asks what's missing, checks official AFCD trail data, live HKO weather, sunset times and AFCD closures, and then returns one of two things:
- a day plan, drawn on a map, with every figure cited, or
- a no-go card that gives the evidence and an alternative.

## Features

**Basic**
- English chat about Hong Kong hiking, using the official data below.

**Additional**
- **Provider-agnostic agent harness.** One loop runs on the Anthropic Messages API, OpenAI Chat Completions (and any OpenAI-compatible server: xAI Grok, DeepSeek, OpenRouter, Ollama), or the OpenAI Responses API (OpenAI or xAI). You switch with `LLM_PROFILE` in `backend/config.yaml`.
- **Safety gate.** `present_plan` and `refuse` are blocked until the agent has actually checked closures and weather (and sunset, for plans) for those trails on that date. A plan is also blocked when any of its figures (km, official hours, sunset) differ from what the tools returned.
- **Question cards.** When information is missing, the agent pauses and shows single-choice, multiple-choice or free-text cards. It resumes when you answer.
- **Trail knowledge search (RAG).** `search_knowledge` embeds the official hiking.gov.hk trail descriptions (Chinese) with a local multilingual model (bge-m3), so "sea views" or "WWII relics" in English finds the right trails. It ranks only the trails that already passed the hard filters, and the plan cites the passage it relied on.
- **Elevation profiles.** Total climb and high point come from the official GPX tracks (smoothed, so DEM noise doesn't inflate the climb). They're searchable ("not too steep") and drawn as a chart on the plan card.
- **Evaluation suite.** 43 graded scenarios (go plans, closures, T8/rainstorm/thunderstorm/heat, ability and daylight limits, out of scope, pushback) run through the real harness on frozen feeds. They report pass and safety rates, gate blocks and self-corrections, and a no-tools baseline for comparison (`backend/eval/`).
- **Runs on local models.** The same harness drives Ollama (qwen3), with a dedicated server script and robustness fixes for small models (empty-turn retry, strict trail ids).
- **Skills.** Step-by-step procedures (intake, search, recommend, plan, maps, safety) that the agent loads only when needed.
- **Official live data.**
  - AFCD *Hiking Trails in Country Parks*: 152 sections, geometry and GPX tracks.
  - Official walking times and star ratings from hiking.gov.hk.
  - AFCD *Closed Trails in Country Parks*.
  - HKO 9-day forecast, current warnings, and sunrise/sunset times.
  - Every live feed has a disk-snapshot fallback so the app still works offline.
- **iOS app (Expo / React Native), "Night trail" design.**
  - Plan home: HKO outlook for today and the weekend (warnings first), suggested requests, recent plans.
  - Full-screen chat: the agent's tool calls collapse to one line ("Checked 4 sources"), clarifying questions are tap-to-answer forms, and a plan arrives as a card that opens a full plan page.
  - Plan page: official AFCD photo, stats, the safety checks the server enforces, a scrubbable elevation profile, the route map, sources, and one-tap follow-ups ("Shorter", "Less climbing").
  - Trails tab: browse and search all 152 official trails, list or map, each with its own page and a "Plan this hike" hand-off to the agent.
  - Native iOS: SF Symbols, Liquid Glass tab bar and controls, Apple Maps; dark by default, with a light mode for projectors (Settings → Appearance).
- **Voice.** Tap the mic to speak your request (on-device speech recognition, live transcript); the app reads the plan aloud (text-to-speech).
- **Demo scenarios.** Settings → Demo scenario injects a T8 signal, a red rainstorm, a thunderstorm or a trail closure, so a refusal can be shown on cue.

## Run it

Once everything below is set up, one command starts Ollama, the backend and Metro, and opens the app in the iOS Simulator. It builds the app only if the simulator doesn't have it yet, and Ctrl-C stops everything:

```bash
scripts/dev.sh              # --build after native changes, --profile <name>, --no-ollama, --device "<simulator>"
```

### 1. Backend

Requires Python 3.12 and [uv](https://docs.astral.sh/uv/).

```bash
cd backend
cp .env.example .env            # add ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY, pick LLM_PROFILE (e.g. grok)
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
curl localhost:8000/health      # shows the provider and model in use
uv run pytest                   # tests use a scripted fake model and need no API key or network
```

To refresh the frozen trail dataset (takes about 1 minute; polite scraping of hiking.gov.hk):

```bash
uv --project backend run python scripts/ingest_afcd.py
```

### Local models (optional, no API key)

Requires [Ollama](https://ollama.com).

```bash
ollama pull qwen3:8b && ollama pull bge-m3
scripts/ollama_serve.sh                    # port 11435 with a 32k context (Ollama's default truncates the prompt)
# backend/.env: LLM_PROFILE=ollama and OLLAMA_API_KEY=ollama (any value)
cd backend && uv run python -m eval.chat --profile ollama     # chat in the terminal
```

### Evaluation

```bash
cd backend
uv run python -m eval.run --profile ollama        # 43 cases, frozen weather/closure feeds; about 4 min per case on qwen3:8b
uv run python -m eval.baseline --profile ollama   # the same cases without tools
uv run python -m eval.run --summarize eval/results/*.jsonl
```

### 2. iOS app

Requires macOS, Xcode with an iOS Simulator runtime, and Node 20 or later.

```bash
cd mobile
npm install
echo "GOOGLE_MAPS_IOS_KEY=..." > .env   # optional; without it the map falls back to Apple Maps
LANG=en_US.UTF-8 npx expo run:ios       # development build (Expo Go is not enough: maps + speech are native)
```

The official AFCD trail photos (~50 MB, credited in the app) are committed in `data/photos/`; trails without one show their route instead. To refresh them:

```bash
uv --project backend run python scripts/fetch_photos.py
```

In the app, open Settings (gear on the Plan tab) and set the backend URL:
- Simulator: `http://localhost:8000`
- iPhone on the same Wi-Fi or hotspot: `http://<laptop IP>:8000`

## Layout

```
backend/   FastAPI app: app/llm (3 provider adapters + embeddings), app/agent (harness, session, prompts), app/tools, app/skills; eval/
mobile/    Expo app: src/app (tabs, chat, plan, trail, map, settings), src/components (ui, chat, trail, plan), src/lib (protocol, state, REST)
data/      trails.json, trails_raw.geojson, gpx/, snapshots/ (from scripts/ingest_afcd.py); knowledge.json (scripts/build_knowledge.py); photos/ (scripts/fetch_photos.py)
docs/      spec, architecture poster
```

Data sources: AFCD (DATA.GOV.HK / CSDI), hiking.gov.hk, and the Hong Kong Observatory Open Data API.
