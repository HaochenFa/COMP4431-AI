import { createContext, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';

import { useSettings } from './settings';
import type { CardAnswer, ChatItem, ClientEvent, Refusal, ServerEvent, Track, TripPlan } from './types';

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
const uid = () => `i${++seq}`;

function reducer(state: State, action: Action): State {
  if (action.type === 'clear') return { ...initial, scenario: state.scenario, model: state.model };
  if (action.type === 'local_user') {
    return { ...state, busy: true, items: [...state.items, { kind: 'user', id: uid(), text: action.text, source: action.source }] };
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
    case 'hello':
      return { ...state, scenario: ev.scenario, model: ev.model, waitingFor: ev.waiting_for };
    case 'assistant_delta':
      if (last?.kind === 'assistant') return { ...state, items: [...items.slice(0, -1), { ...last, text: last.text + ev.text }] };
      return { ...state, items: [...items, { kind: 'assistant', id: uid(), text: ev.text }] };
    case 'assistant_done':
      return { ...state, busy: false, waitingFor: ev.waiting_for ?? null };
    case 'tool_trace': {
      const step = { call_id: ev.call_id, name: ev.name, status: ev.status, summary: ev.summary };
      if (last?.kind === 'tools') {
        const exists = last.steps.some((s) => s.call_id === ev.call_id);
        const steps = exists ? last.steps.map((s) => (s.call_id === ev.call_id ? { ...s, ...step } : s)) : [...last.steps, step];
        return { ...state, items: [...items.slice(0, -1), { ...last, steps }] };
      }
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

type AgentApi = State & {
  connected: boolean;
  send: (text: string, source?: 'text' | 'voice') => void;
  answer: (callId: string, answers: CardAnswer[]) => void;
  setScenario: (scenario: string) => void;
  reset: () => void;
};

const AgentContext = createContext<AgentApi | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const { settings, ready } = useSettings();
  const [state, dispatch] = useReducer(reducer, initial);
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!ready) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const url = `${settings.backendUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/ws/chat?session=${encodeURIComponent(settings.sessionId)}`;

    const connect = () => {
      const socket = new WebSocket(url);
      ws.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onmessage = (m) => dispatch({ type: 'server', event: JSON.parse(String(m.data)) as ServerEvent });
      socket.onclose = () => {
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

  const post = (ev: ClientEvent) => {
    if (ws.current?.readyState !== WebSocket.OPEN) return false;
    ws.current.send(JSON.stringify(ev));
    return true;
  };

  const api: AgentApi = {
    ...state,
    connected,
    send: (text, source = 'text') => {
      const clean = text.trim();
      if (!clean || !post({ type: 'user_message', text: clean, source })) return;
      dispatch({ type: 'local_user', text: clean, source });
    },
    answer: (callId, answers) => {
      if (post({ type: 'card_answer', call_id: callId, answers })) dispatch({ type: 'local_answer', call_id: callId, answers });
    },
    setScenario: (scenario) => post({ type: 'set_scenario', scenario }),
    reset: () => post({ type: 'reset' }),
  };

  return <AgentContext.Provider value={api}>{children}</AgentContext.Provider>;
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent outside AgentProvider');
  return ctx;
}
