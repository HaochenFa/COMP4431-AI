import * as Speech from 'expo-speech';
import { useEffect } from 'react';

import { useAgent } from './agent';
import { useSettings } from './settings';
import type { Refusal, TripPlan } from './types';
import { SPEECH_LANG } from './voice';

/** The short version a hiker wants to hear: go or no-go, how long, and when it gets dark. */
export function speakOutcome(o: { kind: 'plan'; plan: TripPlan } | { kind: 'refusal'; refusal: Refusal }) {
  const line =
    o.kind === 'plan'
      ? `Go. ${o.plan.primary.name}. ${o.plan.primary.hours} hours. Finish around ${o.plan.finish_time}, sunset ${o.plan.sunset}.`
      : `No go. ${o.refusal.summary}${o.refusal.counterfactual ? ` Instead: ${o.refusal.counterfactual}` : ''}`;
  Speech.stop();
  Speech.speak(line, { language: SPEECH_LANG, rate: 1.0 });
}

/** Reads each new plan or refusal aloud when Settings → Read plans aloud is on, whichever screen is open. */
export function useSpeakOutcomes() {
  const { lastOutcome } = useAgent();
  const { settings } = useSettings();
  useEffect(() => {
    if (lastOutcome && settings.speakReplies) speakOutcome(lastOutcome);
  }, [lastOutcome, settings.speakReplies]);
}
