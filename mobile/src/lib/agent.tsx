import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';

import { useRecent } from './recent';
import { newSessionId, useSettings } from './settings';
import type { CardAnswer, ChatItem, ClientEvent, Outcome, Refusal, ServerEvent, ToolStep, Track, TripPlan } from './types';

type State = {
  items: ChatItem[];
  tracks: Track[];
  busy: boolean;
  waitingFor: string | null;
  scenario: string;
  model: string;
  lastOutcome: { kind: 'plan'; plan: TripPlan } | { kind: 'refusal'; refusal: Refusal } | null;
};

type Action =
  | { type: 'server'; event: ServerEvent }
  | { type: 'local_user'; text: string; source: 'text' | 'voice' }
  | { type: 'local_answer'; call_id: string; answers: CardAnswer[] }
  | { type: 'clear' };

const initial: State = { items: [], tracks: [], busy: false, waitingFor: null, scenario: 'live', model: '', lastOutcome: null };
let seq = 0;
// Unique across app launches: plan ids are persisted (lib/recent.tsx) and must not collide after a reload.
const uid = () => `i${Date.now().toString(36)}${(++seq).toString(36)}`;

function reducer(state: State, action: Action): State {
  if (action.type === 'clear') return { ...initial, scenario: state.scenario, model: state.model };
  if (action.type === 'local_user') {
    // Typing while a question is waiting answers it on the server, so lock that card here too.
    const items = state.waitingFor
      ? state.items.map((it) => (it.kind === 'ask' && it.call_id === state.waitingFor && !it.answered ? { ...it, answered: [] } : it))
      : state.items;
    return { ...state, busy: true, waitingFor: null, items: [...items, { kind: 'user', id: uid(), text: action.text, source: action.source }] };
  }
  if (action.type === 'local_answer') {
    return {
      ...state,
      busy: true,
      waitingFor: null,
      items: state.items.map((it) => (it.kind === 'ask' && it.call_id === action.call_id ? { ...it, answered: action.answers } : it)),
    };
  }

  const ev = action.event;
  const items = state.items;
  const last = items[items.length - 1];
  switch (ev.type) {
    case 'hello': {
      // After a reconnect or app reload, re-show a question the server is still waiting on.
      const ask = ev.pending_ask;
      const shown = !ask || items.some((it) => it.kind === 'ask' && it.call_id === ask.call_id);
      return {
        ...state,
        scenario: ev.scenario,
        model: ev.model,
        waitingFor: ev.waiting_for,
        items: shown ? items : [...items, { kind: 'ask', id: uid(), call_id: ask.call_id, cards: ask.cards }],
      };
    }
    case 'assistant_delta':
      if (last?.kind === 'assistant') return { ...state, items: [...items.slice(0, -1), { ...last, text: last.text + ev.text }] };
      return { ...state, items: [...items, { kind: 'assistant', id: uid(), text: ev.text }] };
    case 'assistant_reset':
      return last?.kind === 'assistant' ? { ...state, items: items.slice(0, -1) } : state;
    case 'assistant_done':
      return { ...state, busy: false, waitingFor: ev.waiting_for ?? null };
    case 'tool_trace': {
      // `args` arrive with the start event; later events for the same call keep them.
      const step: ToolStep = { call_id: ev.call_id, name: ev.name, status: ev.status, summary: ev.summary, ...(ev.args ? { args: ev.args } : {}) };
      // A tool that shows a card (plan, refusal, question) finishes after its card, so its step
      // may no longer be in the last item: update it wherever it is.
      const at = items.findLastIndex((it) => it.kind === 'tools' && it.steps.some((s) => s.call_id === ev.call_id));
      if (at >= 0) {
        const it = items[at] as Extract<ChatItem, { kind: 'tools' }>;
        const updated = { ...it, steps: it.steps.map((s) => (s.call_id === ev.call_id ? { ...s, ...step } : s)) };
        return { ...state, items: items.map((x, i) => (i === at ? updated : x)) };
      }
      if (last?.kind === 'tools') return { ...state, items: [...items.slice(0, -1), { ...last, steps: [...last.steps, step] }] };
      return { ...state, items: [...items, { kind: 'tools', id: uid(), steps: [step] }] };
    }
    case 'ask_user':
      return { ...state, items: [...items, { kind: 'ask', id: uid(), call_id: ev.call_id, cards: ev.cards }] };
    case 'map': {
      const t = ev.payload;
      // One primary and one backup at a time; a new one replaces the old. Rejected tracks accumulate.
      const others = state.tracks.filter((x) => x.trail_id !== t.trail_id && (t.role === 'rejected' || x.role !== t.role));
      return { ...state, tracks: [...others, t] };
    }
    case 'plan':
      return { ...state, lastOutcome: { kind: 'plan', plan: ev.plan }, items: [...items, { kind: 'plan', id: uid(), plan: ev.plan }] };
    case 'refusal':
      return { ...state, lastOutcome: { kind: 'refusal', refusal: ev.refusal }, items: [...items, { kind: 'refusal', id: uid(), refusal: ev.refusal }] };
    case 'scenario':
      return { ...state, scenario: ev.scenario };
    case 'reset_ok':
      return { ...initial, scenario: state.scenario, model: state.model };
    case 'error':
      return { ...state, items: [...items, { kind: 'error', id: uid(), message: ev.message }] };
    default:
      return state;
  }
}

// The checks the safety gate requires before a plan or refusal (tools/agentic.py).
const CHECKS = ['check_closures', 'get_weather', 'get_daylight'];

/** The latest closure / weather / daylight steps between the user message before `itemId` and that item. */
export function checksBefore(items: ChatItem[], itemId: string): ToolStep[] {
  const at = items.findIndex((it) => it.id === itemId);
  const latest = new Map<string, ToolStep>();
  for (let i = at - 1; i >= 0 && items[i].kind !== 'user'; i--) {
    const it = items[i];
    if (it.kind !== 'tools') continue;
    for (const s of [...it.steps].reverse()) if (CHECKS.includes(s.name) && !latest.has(s.name)) latest.set(s.name, s);
  }
  return CHECKS.flatMap((n) => latest.get(n) ?? []);
}

type AgentApi = State & {
  connected: boolean;
  /** Text waiting in the chat composer (e.g. "Plan this hike" from a trail page). */
  draft: string;
  setDraft: (text: string) => void;
  send: (text: string, source?: 'text' | 'voice') => boolean;
  answer: (callId: string, answers: CardAnswer[]) => void;
  setScenario: (scenario: string) => void;
  newConversation: () => void;
  trackFor: (trailId: string) => Track | undefined;
};

const AgentContext = createContext<AgentApi | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const { settings, ready, update } = useSettings();
  const { add } = useRecent();
  const [state, dispatch] = useReducer(reducer, initial);
  const [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState('');
  const ws = useRef<WebSocket | null>(null);
  const saved = useRef(new Set<string>());

  useEffect(() => {
    if (!ready) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const url = `${settings.backendUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/ws/chat?session=${encodeURIComponent(settings.sessionId)}`;

    const connect = () => {
      const socket = new WebSocket(url);
      ws.current = socket;
      // A replaced socket (settings change, reconnect) can still fire late events: ignore them.
      const current = () => ws.current === socket;
      socket.onopen = () => current() && setConnected(true);
      socket.onmessage = (m) => current() && dispatch({ type: 'server', event: JSON.parse(String(m.data)) as ServerEvent });
      socket.onclose = () => {
        if (!current()) return;
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
      socket.onerror = () => socket.close();
    };
    dispatch({ type: 'clear' });
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, [ready, settings.backendUrl, settings.sessionId]);

  // Keep every plan and refusal on the device, with the checks that let it through the gate.
  useEffect(() => {
    for (const it of state.items) {
      if ((it.kind !== 'plan' && it.kind !== 'refusal') || saved.current.has(it.id)) continue;
      saved.current.add(it.id);
      const base = { id: it.id, checks: checksBefore(state.items, it.id), savedAt: Date.now() };
      add(it.kind === 'plan' ? ({ ...base, kind: 'plan', plan: it.plan } satisfies Outcome) : { ...base, kind: 'refusal', refusal: it.refusal });
    }
  }, [state.items, add]);

  const post = (ev: ClientEvent) => {
    if (ws.current?.readyState !== WebSocket.OPEN) return false;
    ws.current.send(JSON.stringify(ev));
    return true;
  };

  const trackFor = useCallback((trailId: string) => state.tracks.find((t) => t.trail_id === trailId), [state.tracks]);

  const api: AgentApi = {
    ...state,
    connected,
    draft,
    setDraft,
    send: (text, source = 'text') => {
      const clean = text.trim();
      if (!clean || !post({ type: 'user_message', text: clean, source })) return false;
      dispatch({ type: 'local_user', text: clean, source });
      return true;
    },
    answer: (callId, answers) => {
      if (post({ type: 'card_answer', call_id: callId, answers })) dispatch({ type: 'local_answer', call_id: callId, answers });
    },
    setScenario: (scenario) => post({ type: 'set_scenario', scenario }),
    newConversation: () => {
      setDraft('');
      update({ sessionId: newSessionId() });
    },
    trackFor,
  };

  return <AgentContext.Provider value={api}>{children}</AgentContext.Provider>;
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent outside AgentProvider');
  return ctx;
}
