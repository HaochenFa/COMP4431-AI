// Mirrors backend/app/schemas.py and the WebSocket protocol in backend/app/agent/harness.py.

export type Citation = { source: string; ref: string; quote: string };
export type TrailPick = { id: string; name: string; length_km: number; hours: number; stars?: number | null };

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
  coords: LatLng[];
  markers: { kind: 'start' | 'finish'; label: string; coord: LatLng }[];
};

export type ToolStatus = 'start' | 'ok' | 'error' | 'blocked' | 'waiting';

export type ServerEvent =
  | { type: 'hello'; session: string; scenario: string; model: string; waiting_for: string | null }
  | { type: 'assistant_delta'; text: string }
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
  | { kind: 'tools'; id: string; steps: { call_id: string; name: string; status: ToolStatus; summary?: string }[] }
  | { kind: 'ask'; id: string; call_id: string; cards: QuestionCard[]; answered?: CardAnswer[] }
  | { kind: 'plan'; id: string; plan: TripPlan }
  | { kind: 'refusal'; id: string; refusal: Refusal }
  | { kind: 'error'; id: string; message: string };
