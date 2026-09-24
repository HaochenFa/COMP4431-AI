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
- **Provider-agnostic agent harness.** One loop runs on the Anthropic Messages API, OpenAI Chat Completions (and any OpenAI-compatible server: DeepSeek, OpenRouter, Ollama), or the OpenAI Responses API. You switch with `LLM_PROFILE` in `backend/config.yaml`.
- **Safety gate.** `present_plan` and `refuse` are blocked until the agent has actually checked closures and weather (and sunset, for plans) for those trails on that date. A plan is also blocked when any of its figures (km, official hours, sunset) differ from what the tools returned.
- **Question cards.** When information is missing, the agent pauses and shows single-choice, multiple-choice or free-text cards. It resumes when you answer.
- **Skills.** Step-by-step procedures (intake, search, recommend, plan, maps, safety) that the agent loads only when needed.
- **Official live data.**
  - AFCD *Hiking Trails in Country Parks*: 152 sections, geometry and GPX tracks.
  - Official walking times and star ratings from hiking.gov.hk.
  - AFCD *Closed Trails in Country Parks*.
  - HKO 9-day forecast, current warnings, and sunrise/sunset times.
  - Every live feed has a disk-snapshot fallback so the app still works offline.
- **iOS app (Expo / React Native).**
  - Full-screen Google terrain map showing the official tracks.
  - Chat in a bottom sheet, like AllTrails.
  - Plan and no-go cards with citations.
- **Voice.** Hold the mic to speak your request (on-device speech recognition); the app reads the plan aloud (text-to-speech).
- **Demo scenarios.** Settings → Demo scenario injects a T8 signal, a red rainstorm, a thunderstorm or a trail closure, so a refusal can be shown on cue.

## Run it

### 1. Backend

Requires Python 3.12 and [uv](https://docs.astral.sh/uv/).

```bash
cd backend
cp .env.example .env            # add ANTHROPIC_API_KEY and/or OPENAI_API_KEY, pick LLM_PROFILE
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
curl localhost:8000/health      # shows the provider and model in use
uv run pytest                   # tests use a scripted fake model and need no API key or network
```

To refresh the frozen trail dataset (takes about 1 minute; polite scraping of hiking.gov.hk):

```bash
uv --project backend run python scripts/ingest_afcd.py
```

### 2. iOS app

Requires macOS, Xcode with an iOS Simulator runtime, and Node 20 or later.

```bash
cd mobile
npm install
echo "GOOGLE_MAPS_IOS_KEY=..." > .env   # optional; without it the map falls back to Apple Maps
npx expo run:ios                         # development build (Expo Go is not enough: maps + speech are native)
```

In the app, open ⚙︎ Settings and set the backend URL:
- Simulator: `http://localhost:8000`
- iPhone on the same Wi-Fi or hotspot: `http://<laptop IP>:8000`

## Layout

```
backend/   FastAPI app: app/llm (3 provider adapters), app/agent (harness, session, prompts), app/tools, app/skills
mobile/    Expo app: src/app (screens), src/components (map, chat sheet, cards, voice), src/lib (protocol, state)
data/      trails.json, trails_raw.geojson, gpx/, snapshots/  (from scripts/ingest_afcd.py)
docs/      spec, architecture poster
```

Data sources: AFCD (DATA.GOV.HK / CSDI), hiking.gov.hk, and the Hong Kong Observatory Open Data API.
