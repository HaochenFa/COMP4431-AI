import { router } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';

import { useAgent } from './agent';

// Shown as title + detail; `text` is what the agent receives.
export const PROMPTS: { icon: SFSymbol; title: string; detail: string; text: string }[] = [
  { icon: 'water.waves', title: 'Sea views, half a day', detail: 'Saturday, from an MTR station', text: 'Half a day with sea views on Saturday, starting from an MTR station' },
  { icon: 'figure.walk', title: 'An easy first hike', detail: 'Tomorrow morning, for a beginner', text: 'An easy walk for a beginner tomorrow morning' },
  { icon: 'sunset', title: 'Ridge walk, home by dusk', detail: 'Sunday, finishing before sunset', text: 'A ridge hike on Sunday that finishes before sunset' },
  { icon: 'cloud.rain', title: 'After last night’s rain', detail: 'Is Lion Rock OK tomorrow?', text: 'It rained last night. Is Lion Rock OK tomorrow?' },
];

/** Hands a prompt to the agent and opens the conversation (or leaves it in the composer when offline). */
export function useAsk() {
  const agent = useAgent();
  return (text: string) => {
    if (!agent.send(text)) agent.setDraft(text);
    router.push('/chat');
  };
}

/** SF weather symbol (multicolour) for an HKO forecast phrase. */
export function weatherIcon(text?: string | null): SFSymbol {
  const t = (text ?? '').toLowerCase();
  if (/thunder/.test(t)) return 'cloud.bolt.rain.fill';
  if (/heavy rain|rainstorm|squally/.test(t)) return 'cloud.heavyrain.fill';
  if (/shower|rain|drizzle/.test(t)) return /sunny|bright|fine/.test(t) ? 'cloud.sun.rain.fill' : 'cloud.rain.fill';
  if (/fog|mist|haze|hazy/.test(t)) return 'cloud.fog.fill';
  if (/sunny|fine|bright/.test(t)) return /cloud|period|interval/.test(t) ? 'cloud.sun.fill' : 'sun.max.fill';
  if (/cloud|overcast/.test(t)) return 'cloud.fill';
  if (/hot/.test(t)) return 'sun.max.fill';
  return 'cloud.sun.fill';
}
