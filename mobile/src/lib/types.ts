// Mirrors backend/app/schemas.py and the WebSocket protocol in backend/app/agent/harness.py.

export type Citation = { source: string; ref: string; quote: string };
export type TrailPick = {
  id: string;
  name: string;
  length_km: number;
  hours: number;
  stars?: number | null;
  // Added by the server from the dataset when the plan card is emitted.
  start?: string;
  start_coord?: LatLng | null;
  profile?: ElevationProfile | null;
};

// From the official GPX (backend/app/tools/data.py profiles()); null when the GPX has no heights.
export type ElevationProfile = {
  d_km: number[];
  ele_m: number[];
  ascent_m: number;
  descent_m: number;
  max_m: number;
  min_m: number;
  source: string;
};

export type TripPlan = {
  decision: 'go';
  date: string;
  primary: TrailPick;
  backup?: TrailPick | null;
  why_this: string;
  why_not: { trail_id: string; reason: string }[];
  timeline: { label: string; start: string; end: string }[];
  finish_time: string;
  sunset: string;
  weather_summary: string;
  citations: Citation[];
};

export type Refusal = {
  decision: 'no_go';
  date: string;
  trail_ids: string[];
  code: string;
  summary: string;
  evidence: Citation[];
  counterfactual?: string | null;
};

export type QuestionCard = { id: string; type: 'single' | 'multi' | 'text'; prompt: string; options?: string[] };
export type CardAnswer = { id: string; value: string | string[] };

export type LatLng = [number, number];
export type TrackRole = 'primary' | 'backup' | 'rejected';
export type Track = {
  trail_id: string;
  name: string;
  role: TrackRole;
  segments: LatLng[][]; // drawn separately: joining them would draw lines across gaps in the track
  markers: { kind: 'start' | 'finish'; label: string; coord: LatLng }[];
  profile?: ElevationProfile | null;
};

export type ToolStatus = 'start' | 'ok' | 'error' | 'blocked' | 'waiting';
export type ToolStep = { call_id: string; name: string; status: ToolStatus; summary?: string; args?: Record<string, unknown> };

export type ServerEvent =
  | {
      type: 'hello';
      session: string;
      scenario: string;
      model: string;
      waiting_for: string | null;
      pending_ask: { call_id: string; cards: QuestionCard[] } | null;
    }
  | { type: 'assistant_delta'; text: string }
  | { type: 'assistant_reset' } // the model's turn was re-issued: drop the text streamed so far
  | { type: 'assistant_done'; waiting_for?: string }
  | { type: 'tool_trace'; call_id: string; name: string; status: ToolStatus; args?: Record<string, unknown>; summary?: string }
  | { type: 'ask_user'; call_id: string; cards: QuestionCard[] }
  | { type: 'map'; op: 'draw_gpx'; payload: Track }
  | { type: 'plan'; plan: TripPlan }
  | { type: 'refusal'; refusal: Refusal }
  | { type: 'scenario'; scenario: string }
  | { type: 'reset_ok' }
  | { type: 'error'; message: string };

export type ClientEvent =
  | { type: 'user_message'; text: string; source: 'text' | 'voice' }
  | { type: 'card_answer'; call_id: string; answers: CardAnswer[] }
  | { type: 'set_scenario'; scenario: string }
  | { type: 'reset' };

// What the chat list renders.
export type ChatItem =
  | { kind: 'user'; id: string; text: string; source: 'text' | 'voice' }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tools'; id: string; steps: ToolStep[] }
  | { kind: 'ask'; id: string; call_id: string; cards: QuestionCard[]; answered?: CardAnswer[] }
  | { kind: 'plan'; id: string; plan: TripPlan }
  | { kind: 'refusal'; id: string; refusal: Refusal }
  | { kind: 'error'; id: string; message: string };

// A plan or refusal kept on the device (lib/recent.tsx), with the safety checks that preceded it.
export type Outcome =
  | { id: string; kind: 'plan'; plan: TripPlan; checks: ToolStep[]; savedAt: number }
  | { id: string; kind: 'refusal'; refusal: Refusal; checks: ToolStep[]; savedAt: number };

// REST: backend/app/rest.py
export type TrailSummary = {
  id: string;
  name: string;
  trail: string;
  section: number | null;
  region: string;
  difficulty: string;
  start: string;
  finish: string;
  length_km: number | null;
  hours: number | null;
  stars: number | null;
  ascent_m: number | null;
  max_m: number | null;
  start_coord: LatLng | null;
  photo: boolean;
  /** English names of landmarks the official (Chinese) description mentions, e.g. "Dragon's Back". */
  landmarks: string[];
};

export type TrailDetail = {
  id: string;
  name: string;
  name_zh?: string;
  trail: string;
  section: number | null;
  type?: string;
  region: string;
  difficulty: string;
  start: string;
  finish: string;
  length_km: number | null;
  official_hours?: number;
  stars?: number;
  url?: string | null;
  description_zh?: string;
  segments: LatLng[][];
  profile: ElevationProfile | null;
  photo: boolean;
  landmarks: string[];
};

export type ConditionsDay = {
  date: string;
  summary?: string | null;
  max_c?: number | null;
  min_c?: number | null;
  rain?: string | null;
  sunset?: string;
  no_go?: string[];
  error?: string;
};

/** An HKO warning in force (warnsum), keyed by type: WHOT, WTCSGNL, WRAIN… `issued` is absent for demo overrides. */
export type Warning = { name?: string; code?: string; type?: string; issued?: string };

export type Conditions = {
  scenario: string;
  warnings: Record<string, Warning>;
  days: ConditionsDay[];
};
