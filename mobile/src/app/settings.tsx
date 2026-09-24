import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { C } from '@/constants/palette';
import { useAgent } from '@/lib/agent';
import { newSessionId, useSettings } from '@/lib/settings';

// Demo scenarios override HKO warnings / AFCD closures on the server so a refusal can be shown on cue.
const SCENARIOS = [
  { id: 'live', label: 'Live data' },
  { id: 'clear', label: 'Clear skies' },
  { id: 't8', label: 'Typhoon T8' },
  { id: 'rainstorm', label: 'Red rainstorm' },
  { id: 'thunderstorm', label: 'Thunderstorm' },
  { id: 'closure:hk_8', label: "Close Dragon's Back" },
];

export default function SettingsScreen() {
  const { settings, update } = useSettings();
  const agent = useAgent();
  const [url, setUrl] = useState(settings.backendUrl);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.label}>Backend URL</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onEndEditing={() => update({ backendUrl: url.trim() })}
      />
      <Text style={styles.help}>
        {agent.connected ? `Connected · ${agent.model}` : 'Not connected'}. Simulator: http://localhost:8000. iPhone: http://&lt;laptop IP&gt;:8000.
      </Text>

      <View style={styles.row}>
        <Text style={styles.label}>Read plans aloud</Text>
        <Switch value={settings.speakReplies} onValueChange={(v) => update({ speakReplies: v })} trackColor={{ true: C.moss }} />
      </View>

      <Text style={styles.label}>Demo scenario</Text>
      <View style={styles.options}>
        {SCENARIOS.map((s) => (
          <Pressable key={s.id} onPress={() => agent.setScenario(s.id)} style={[styles.option, agent.scenario === s.id && styles.optionOn]}>
            <Text style={[styles.optionText, agent.scenario === s.id && { color: C.white }]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable onPress={() => update({ sessionId: newSessionId() })} style={styles.danger}>
        <Text style={styles.dangerText}>Start a new conversation</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10, backgroundColor: C.paper, flexGrow: 1 },
  label: { fontSize: 13, fontWeight: '700', color: C.ink, letterSpacing: 0.3 },
  input: { backgroundColor: C.white, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 12, fontSize: 15, color: C.ink },
  help: { fontSize: 12, color: C.muted },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { borderWidth: 1.5, borderColor: C.ink, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  optionOn: { backgroundColor: C.ink },
  optionText: { color: C.ink, fontWeight: '600' },
  danger: { marginTop: 20, borderWidth: 1.5, borderColor: C.refuse, borderRadius: 10, padding: 12, alignItems: 'center' },
  dangerText: { color: C.refuse, fontWeight: '700' },
});
