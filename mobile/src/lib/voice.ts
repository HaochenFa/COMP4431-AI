import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';

// Same accent as the spoken replies (expo-speech en-GB), which suits Hong Kong English.
export const SPEECH_LANG = 'en-GB';

/**
 * Tap to talk: `start()` listens and streams the interim transcript; `finish()` stops and sends it via
 * `onFinal`; `cancel()` drops it. Recognition that ends by itself (silence) also sends.
 */
export function useVoice({ onFinal }: { onFinal: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [level, setLevel] = useState(0);
  const text = useRef('');
  const cancelled = useRef(false);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    setLevel(0);
    const final = text.current.trim();
    if (final && !cancelled.current) onFinal(final);
    text.current = '';
    setTranscript('');
  });
  useSpeechRecognitionEvent('result', (e) => {
    text.current = e.results[0]?.transcript ?? '';
    setTranscript(text.current);
  });
  useSpeechRecognitionEvent('volumechange', (e) => setLevel(Math.min(Math.max((e.value + 2) / 12, 0), 1)));
  useSpeechRecognitionEvent('error', (e) => {
    setListening(false);
    setLevel(0);
    // Saying nothing and discarding aren't failures.
    if (e.error !== 'aborted' && e.error !== 'no-speech') Alert.alert("Voice didn't work", 'Try again, or type instead.');
  });

  const start = async () => {
    Speech.stop(); // or the app talks over the user and hears itself
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Voice is off', 'Allow the microphone and speech recognition for TrailAI in Settings, or type instead.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
      return false;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    cancelled.current = false;
    text.current = '';
    setTranscript('');
    ExpoSpeechRecognitionModule.start({
      lang: SPEECH_LANG,
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 90 },
    });
    return true;
  };

  const finish = () => {
    Haptics.selectionAsync().catch(() => {});
    ExpoSpeechRecognitionModule.stop();
  };

  const cancel = () => {
    cancelled.current = true;
    ExpoSpeechRecognitionModule.abort();
  };

  return { listening, transcript, level, start, finish, cancel };
}
