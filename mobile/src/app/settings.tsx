import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { ListRow, ListSection, T } from '@/components/ui';
import { radius, useTheme } from '@/constants/theme';
import { useAgent } from '@/lib/agent';
import { SCENARIOS } from '@/lib/scenarios';
import { useSettings, type AppearanceSetting } from '@/lib/settings';

const APPEARANCE: { id: AppearanceSetting; label: string }[] = [
  { id: 'dark', label: 'Night' },
  { id: 'light', label: 'Day' },
  { id: 'system', label: 'System' },
];

export default function SettingsScreen() {
  const { c } = useTheme();
  const { settings, update } = useSettings();
  const agent = useAgent();
  const [url, setUrl] = useState(settings.backendUrl);

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button onPress={() => router.back()}>Done</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
        <ListSection
          title="Appearance"
          footer="Night is the default. Switch to Day when presenting on a projector.">
          {/* The system segmented control (SwiftUI), so it gets the native Liquid Glass selection. */}
          <View style={styles.segmented}>
            <Host matchContents={{ vertical: true }}>
              <Picker<AppearanceSetting>
                selection={settings.appearance}
                onSelectionChange={(appearance) => update({ appearance })}
                modifiers={[pickerStyle('segmented')]}>
                {APPEARANCE.map((a) => (
                  <SwiftText key={a.id} modifiers={[tag(a.id)]}>
                    {a.label}
                  </SwiftText>
                ))}
              </Picker>
            </Host>
          </View>
        </ListSection>

        <ListSection title="Voice" inset={52}>
          <ListRow
            icon="speaker.wave.2"
            title="Read plans aloud"
            accessory={<Switch value={settings.speakReplies} onValueChange={(v) => update({ speakReplies: v })} trackColor={{ true: c.accentInk }} />}
          />
        </ListSection>

        <ListSection title="Demo scenario" footer="Overrides the HKO warnings or AFCD closures on the server, so a no-go can be shown on cue. Results are labelled as demo overrides.">
          {SCENARIOS.map((s) => (
            <ListRow key={s.id} title={s.label} accessory={agent.scenario === s.id ? 'check' : undefined} onPress={() => agent.setScenario(s.id)} />
          ))}
        </ListSection>

        <ListSection
          title="Server"
          footer={`Simulator: http://localhost:8000. iPhone: http://<laptop IP>:8000.`}>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { color: c.text, backgroundColor: c.surface2 }]}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onEndEditing={() => update({ backendUrl: url.trim() })}
              placeholderTextColor={c.text3}
            />
          </View>
          <ListRow
            leading={<View style={[styles.status, { backgroundColor: agent.connected ? c.accentInk : c.danger }]} />}
            title={agent.connected ? 'Connected' : 'Not connected'}
            value={agent.connected ? agent.model : undefined}
          />
        </ListSection>

        <ListSection>
          <ListRow
            icon="square.and.pencil"
            iconColor="danger"
            tone="danger"
            title="Start a new conversation"
            onPress={() => {
              agent.newConversation();
              router.back();
            }}
          />
        </ListSection>

        <T v="caption" color="text3" center>
          Trail data and photos: Agriculture, Fisheries and Conservation Department. Weather, warnings and sunset: Hong Kong Observatory.
        </T>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 28, paddingBottom: 40 },
  segmented: { padding: 12 },
  inputRow: { padding: 12 },
  input: { borderRadius: radius.control, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16 },
  status: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 5 },
});
