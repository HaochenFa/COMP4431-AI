import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useAgent } from './agent';
import { useSettings } from './settings';
import type { Refusal, TripPlan } from './types';

// Speech recognition listens in British English, which suits Hong Kong English. It's also the accent the
// iPhone fallback voice prefers.
export const SPEECH_LANG = 'en-GB';

/** Kokoro voices on the server (backend/app/tts.py), plus the on-device iOS voice. */
export const VOICES = [
  { id: 'af_heart', label: 'Heart', detail: 'American' },
  { id: 'bf_emma', label: 'Emma', detail: 'British' },
  { id: 'am_michael', label: 'Michael', detail: 'American' },
  { id: 'bm_george', label: 'George', detail: 'British' },
  { id: 'device', label: 'iPhone voice', detail: 'On device' },
] as const;

/** Whether the server's voices are ready: 'loading' while it loads (or downloads) the model, 'offline' if unreachable. */
export function useServerVoiceStatus(backendUrl: string): 'ready' | 'loading' | 'offline' {
  const [status, setStatus] = useState<'ready' | 'loading' | 'offline'>('loading');
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = () =>
      fetch(`${backendUrl.replace(/\/$/, '')}/tts/voices`)
        .then((r) => r.json())
        .then((j: { status: string }) => (j.status === 'ready' ? 'ready' : j.status.startsWith('failed') ? 'offline' : 'loading'))
        .catch(() => 'offline' as const)
        .then((s) => {
          if (!live) return;
          setStatus(s);
          if (s === 'loading') timer = setTimeout(check, 3000);
        });
    check();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [backendUrl]);
  return status;
}

const SERVER_TIMEOUT_MS = 8000; // a plan summary takes 1-3 s to synthesise on the laptop

// ---------- What to say ----------

type Outcome = { kind: 'plan'; plan: TripPlan } | { kind: 'refusal'; refusal: Refusal };

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
const words = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`);

/** "17:42" -> "five forty-two", "12:30" -> "twelve thirty", "09:05" -> "nine oh five", "17:00" -> "five o'clock". */
export function sayTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const hour = words(h % 12 || 12);
  return m === 0 ? `${hour} o'clock` : m < 10 ? `${hour} oh ${words(m)}` : `${hour} ${words(m)}`;
}

/** 2.5 -> "two and a half hours", 1 -> "an hour", 1.75 -> "an hour and three quarters" (to the nearest quarter). */
export function sayHours(h: number): string {
  const q = Math.round(h * 4);
  const whole = Math.floor(q / 4);
  const frac = ['', 'a quarter', 'a half', 'three quarters'][q % 4];
  if (whole === 0) return frac === 'a half' ? 'half an hour' : frac === 'a quarter' ? 'fifteen minutes' : 'forty-five minutes';
  if (whole === 1) return frac ? `an hour and ${frac}` : 'an hour';
  return `${words(whole)}${frac ? ` and ${frac === 'three quarters' ? 'three-quarter' : frac}` : ''} hours`;
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function todayHK(): string {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' }); // YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** "today", "tomorrow", "on Saturday" (this week) or "on Saturday 14 November". Dates are HK calendar dates. */
export function sayDay(iso: string, today = todayHK()): string {
  const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const d = new Date(day(iso));
  if (Number.isNaN(d.getTime())) return '';
  const ahead = Math.round((day(iso) - day(today)) / 86_400_000);
  if (ahead === 0) return 'today';
  if (ahead === 1) return 'tomorrow';
  const weekday = WEEKDAYS[d.getUTCDay()];
  return ahead > 1 && ahead < 7 ? `on ${weekday}` : `on ${weekday} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Hong Kong Trail Section 1 (The Peak To Pok Fu Lam Reservoir Road)" -> "…Section 1, from The Peak to Pok Fu Lam Reservoir Road". */
export function sayTrail(name: string): string {
  return name.trim().replace(/\s*\((.+?)\s+To\s+(.+?)\)\s*$/i, ', from $1 to $2');
}

const SHORT_MONTHS: Record<string, string> = Object.fromEntries(MONTHS.map((m) => [m.slice(0, 3), m]));
const SHORT_DAYS: Record<string, string> = Object.fromEntries(WEEKDAYS.map((d) => [d.slice(0, 3), d]));

/**
 * Model-written prose -> something a voice reads naturally: no markdown, units and abbreviations spelled out,
 * clock times in words. Applied to the whole script.
 */
export function speakable(text: string): string {
  return text
    .replace(/[*_`#>]+/g, '')
    .replace(/(\d+)\s?[–-]\s?(\d+)\s?°C/g, '$1 to $2 degrees')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s*\(([^()]+)\)/g, ', $1,')
    .replace(/,\s*([.,;:!?])/g, '$1')
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (t) => sayTime(t))
    .replace(/(\d+(?:\.\d+)?)\s?h\b/g, (_, n) => sayHours(Number(n)))
    .replace(/(\d)\s?km\b/g, '$1 kilometres')
    .replace(/(\d)\s?m\b(?=\s+(?:of|high|above|below|up|down)\b|\s*[,.;:)]|\s*$)/g, '$1 metres') // "653 m of climb"
    .replace(/(\d)\s?m\b/g, '$1-metre') // "four 400 m peaks"
    .replace(/(\d)\s?°C/g, '$1 degrees')
    .replace(/\bNo\.\s?(\d)/g, 'Number $1')
    .replace(/\bT(\d{1,2})\b/g, 'typhoon signal $1')
    .replace(/\bHKO\b/g, 'the Observatory')
    .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b(?=,? \d)/g, (d) => SHORT_DAYS[d])
    .replace(/(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (_, d, m) => `${d} ${SHORT_MONTHS[m]}`)
    .replace(/\be\.g\./gi, 'for example')
    .replace(/\bapprox\.?/gi, 'about')
    .replace(/~\s?/g, 'about ')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s*·\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const sentences = (s: string) => s.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((x) => x.trim()) ?? [s];

/** Go or no-go, how long, when it ends against sunset, and the weather: as a person would say it. */
export function outcomeScript(o: Outcome, today = todayHK()): string {
  if (o.kind === 'refusal') {
    const r = o.refusal;
    const when = r.date ? ` ${sayDay(r.date, today)}` : '';
    // With an alternative, the reason is in the first couple of sentences; the rest tends to repeat the alternative.
    const why = r.counterfactual ? sentences(r.summary).slice(0, 2).join(' ') : r.summary;
    const opener = /no[- ]go/i.test(why) ? '' : `It's a no-go${when}. `; // the summary often says so itself
    return speakable(`${opener}${why}${r.counterfactual ? ` A better option: ${r.counterfactual}` : ''}`);
  }
  const p = o.plan;
  const t = p.primary;
  const when = sayDay(p.date, today);
  const opener = p.provisional
    ? `Here's a provisional plan for ${when.replace(/^on /, '')}. There's no forecast for it yet, so check the weather nearer the time.`
    : `You're good to go ${when}.`;
  const gap = minutes(p.sunset) - minutes(p.finish_time);
  const margin = gap >= 90 ? 'well before' : gap >= 30 ? 'before' : gap >= 0 ? 'just before' : 'after';
  // The server's line is "Mainly fine · 22–27°C · North force 3": the sky and the temperatures are enough.
  const weather = p.provisional ? '' : p.weather_summary.split('·').slice(0, 2).map((s) => s.trim()).filter(Boolean).join(', ');
  return speakable(
    `${opener} ${sayTrail(t.name)}. It's ${t.length_km} km, about ${sayHours(t.hours)}${t.hours_estimated ? ' by our estimate' : ''}. ` +
      `You should finish around ${sayTime(p.finish_time)}, ${margin} sunset at ${sayTime(p.sunset)}.` +
      (weather ? ` Forecast: ${weather}.` : ''),
  );
}

// ---------- Playback ----------

type SpeechState = 'idle' | 'loading' | 'speaking';
let state: SpeechState = 'idle';
const listeners = new Set<() => void>();
const setState = (s: SpeechState) => {
  state = s;
  listeners.forEach((l) => l());
};

let player: AudioPlayer | null = null;
let turn = 0; // bumped by every speak/stop, so a slow request can't start talking over a newer one

/** Stops whatever is being read, server audio or the iOS voice. */
export function stopSpeaking() {
  turn++;
  player?.remove();
  player = null;
  Speech.stop();
  setState('idle');
}

let bestVoice: Promise<string | undefined> | null = null;

/** The most natural installed iOS voice: Premium, then Enhanced, then any; British first. Skips novelty voices. */
function bestDeviceVoice(): Promise<string | undefined> {
  bestVoice ??= Speech.getAvailableVoicesAsync()
    .then((voices) => {
      const rank = (v: Speech.Voice) =>
        (v.identifier.includes('premium') ? 30 : v.quality === Speech.VoiceQuality.Enhanced ? 20 : 10) + (v.language === SPEECH_LANG ? 2 : 1);
      return voices
        .filter((v) => v.language.startsWith('en') && !/speech\.synthesis|eloquence/i.test(v.identifier))
        .sort((a, b) => rank(b) - rank(a))[0]?.identifier;
    })
    .catch(() => undefined);
  return bestVoice;
}

async function speakOnDevice(text: string, mine: number) {
  const voice = await bestDeviceVoice();
  if (mine !== turn) return;
  setState('speaking');
  const done = () => {
    if (mine === turn) setState('idle');
  };
  Speech.speak(text, { language: SPEECH_LANG, voice, onDone: done, onStopped: done, onError: done });
}

/** Plays Kokoro's reading from the server; rejects (so the caller falls back) if the server can't. */
async function speakOnServer(text: string, voice: string, backendUrl: string, mine: number) {
  const url = `${backendUrl.replace(/\/$/, '')}/tts?${new URLSearchParams({ text, voice })}`;
  // Ask first, so a 503 (model still loading) or an unreachable server falls back quickly. The server keeps
  // the clip, so the player's own request for it is instant.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SERVER_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`tts ${r.status}`);
  } finally {
    clearTimeout(timer);
  }
  if (mine !== turn) return;
  const p = createAudioPlayer({ uri: url });
  player = p;
  // Resolves once audio is playing; rejects on an error or if it never starts.
  await new Promise<void>((resolve, reject) => {
    const start = setTimeout(() => {
      sub.remove();
      reject(new Error('tts playback never started'));
    }, SERVER_TIMEOUT_MS);
    const sub = p.addListener('playbackStatusUpdate', (s) => {
      if (mine !== turn || s.error || s.playing) {
        clearTimeout(start);
        sub.remove();
      }
      if (mine !== turn) return resolve();
      if (s.error) return reject(new Error(s.error));
      if (s.playing) {
        setState('speaking');
        resolve();
      }
    });
    p.play();
  });
  const end = p.addListener('playbackStatusUpdate', (s) => {
    if (!s.didJustFinish) return;
    end.remove();
    if (mine === turn) {
      p.remove();
      player = null;
      setState('idle');
    }
  });
}

/** Reads `text` in the chosen voice: Kokoro from the server, or the best iOS voice if that isn't available. */
export async function speak(text: string, voice: string, backendUrl: string) {
  stopSpeaking();
  const mine = turn;
  setState('loading');
  // Plays with the ringer switch off, and takes the session back from speech recognition's record mode.
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, interruptionMode: 'duckOthers' }).catch(() => {});
  if (mine !== turn) return;
  if (voice !== 'device') {
    try {
      await speakOnServer(text, voice, backendUrl, mine);
      return;
    } catch {
      if (mine !== turn) return;
      player?.remove();
      player = null;
    }
  }
  await speakOnDevice(text, mine);
}

export const speakOutcome = (o: Outcome, voice: string, backendUrl: string) => speak(outcomeScript(o), voice, backendUrl);

/** 'loading' while the server reads, 'speaking' while audio plays. */
export function useSpeechState(): SpeechState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Reads each new plan or refusal aloud when Settings → Read plans aloud is on, whichever screen is open. */
export function useSpeakOutcomes() {
  const { lastOutcome } = useAgent();
  const { settings } = useSettings();
  const spoken = useRef(lastOutcome);
  useEffect(() => {
    if (lastOutcome === spoken.current) return; // turning the setting on doesn't replay the last plan
    spoken.current = lastOutcome;
    if (lastOutcome && settings.speakReplies) speakOutcome(lastOutcome, settings.voice, settings.backendUrl);
  }, [lastOutcome, settings.speakReplies, settings.voice, settings.backendUrl]);
}
