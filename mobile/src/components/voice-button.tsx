import * as Haptics from 'expo-haptics';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { C } from '@/constants/palette';

/** Hold to talk. Streams the interim transcript to `onPartial`, sends the final one via `onFinal`. */
export function VoiceButton({ onPartial, onFinal, disabled }: { onPartial: (t: string) => void; onFinal: (t: string) => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false);
  const transcript = useRef('');

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    if (transcript.current.trim()) onFinal(transcript.current.trim());
    transcript.current = '';
  });
  useSpeechRecognitionEvent('result', (e) => {
    transcript.current = e.results[0]?.transcript ?? '';
    onPartial(transcript.current);
  });
  useSpeechRecognitionEvent('error', () => setListening(false));

  const start = async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    transcript.current = '';
    ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true, continuous: false, addsPunctuation: true });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Hold to speak"
      disabled={disabled}
      onPressIn={start}
      onPressOut={() => ExpoSpeechRecognitionModule.stop()}
      style={[styles.btn, listening && styles.on, disabled && { opacity: 0.4 }]}>
      <Text style={[styles.icon, listening && { color: C.ink }]}>{listening ? '●' : '🎙'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: C.post, transform: [{ scale: 1.12 }] },
  icon: { fontSize: 18, color: C.white },
});
