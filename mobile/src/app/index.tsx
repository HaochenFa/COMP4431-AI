import { router } from 'expo-router';
import * as Speech from 'expo-speech';
import { useEffect, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatSheet } from '@/components/chat-sheet';
import { MapCanvas } from '@/components/map-canvas';
import { C } from '@/constants/palette';
import { useAgent } from '@/lib/agent';
import { useSettings } from '@/lib/settings';

export default function Home() {
  const agent = useAgent();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [sheetTop, setSheetTop] = useState(Dimensions.get('window').height * 0.45);

  // Read the outcome aloud: the short version a hiker wants to hear.
  useEffect(() => {
    const o = agent.lastOutcome;
    if (!o || !settings.speakReplies) return;
    const line =
      o.kind === 'plan'
        ? `Go. ${o.plan.primary.name}. ${o.plan.primary.hours} hours. Finish around ${o.plan.finish_time}, sunset ${o.plan.sunset}.`
        : `No go. ${o.refusal.summary}${o.refusal.counterfactual ? ` Instead: ${o.refusal.counterfactual}` : ''}`;
    Speech.stop();
    Speech.speak(line, { language: 'en-GB', rate: 1.0 });
  }, [agent.lastOutcome, settings.speakReplies]);

  const bottomInset = Dimensions.get('window').height - sheetTop;

  return (
    <View style={styles.root}>
      <MapCanvas tracks={agent.tracks} bottomInset={bottomInset} />
      <Pressable onPress={() => router.push('/settings')} style={[styles.settings, { top: insets.top + 8 }]} accessibilityLabel="Settings">
        <Text style={styles.settingsText}>⚙︎</Text>
      </Pressable>
      <ChatSheet onHeightChange={setSheetTop} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  settings: {
    position: 'absolute',
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsText: { fontSize: 18, color: C.ink },
});
