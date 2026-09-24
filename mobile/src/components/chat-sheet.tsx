import BottomSheet, { BottomSheetFlatList, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C } from '@/constants/palette';
import { useAgent } from '@/lib/agent';
import type { ChatItem } from '@/lib/types';

import { PlanCard, QuestionCards, RefusalCard, ToolChips } from './cards';
import { VoiceButton } from './voice-button';

const EXAMPLES = ['Saturday, half day, sea view, from an MTR. It rained last night.', 'Is Chi Ma Wan OK for a beginner tomorrow?'];

export function ChatSheet({ onHeightChange }: { onHeightChange: (h: number) => void }) {
  const agent = useAgent();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const list = useRef<any>(null);
  const snapPoints = useMemo(() => ['22%', '55%', '92%'], []);

  useEffect(() => {
    setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }, [agent.items]);

  const submit = (text: string, source: 'text' | 'voice' = 'text') => {
    agent.send(text, source);
    setDraft('');
  };

  const renderItem = ({ item }: { item: ChatItem }) => {
    switch (item.kind) {
      case 'user':
        return (
          <View style={styles.userBubble}>
            <Text style={styles.userText}>
              {item.source === 'voice' ? '🎙 ' : ''}
              {item.text}
            </Text>
          </View>
        );
      case 'assistant':
        return <Text style={styles.assistantText}>{item.text}</Text>;
      case 'tools':
        return <ToolChips item={item} />;
      case 'ask':
        return <QuestionCards cards={item.cards} answered={item.answered} onSubmit={(a) => agent.answer(item.call_id, a)} />;
      case 'plan':
        return <PlanCard plan={item.plan} />;
      case 'refusal':
        return <RefusalCard refusal={item.refusal} />;
      case 'error':
        return <Text style={styles.error}>⚠ {item.message}</Text>;
    }
  };

  return (
    <BottomSheet
      index={1}
      snapPoints={snapPoints}
      keyboardBehavior="extend"
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={{ backgroundColor: C.line, width: 44 }}
      onChange={(_, pos) => onHeightChange(pos)}>
      <View style={styles.header}>
        <Text style={styles.brand}>Trailhead</Text>
        <View style={[styles.dot, { backgroundColor: agent.connected ? C.moss : C.refuse }]} />
        {agent.scenario !== 'live' && <Text style={styles.scenario}>DEMO: {agent.scenario}</Text>}
        {agent.busy && <Text style={styles.busy}>thinking…</Text>}
      </View>
      <BottomSheetFlatList
        ref={list}
        data={agent.items}
        keyExtractor={(i: ChatItem) => i.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={{ gap: 8 }}>
            <Text style={styles.hint}>Tell me about the hike you have in mind — or hold the mic and say it.</Text>
            {EXAMPLES.map((e) => (
              <Pressable key={e} onPress={() => submit(e)} style={styles.example}>
                <Text style={styles.exampleText}>{e}</Text>
              </Pressable>
            ))}
          </View>
        }
      />
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <BottomSheetTextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={agent.waitingFor ? 'Answer the card, or type…' : 'Where do you want to hike?'}
          placeholderTextColor={C.muted}
          onSubmitEditing={() => submit(draft)}
          returnKeyType="send"
          editable={agent.connected}
        />
        <VoiceButton disabled={!agent.connected || agent.busy} onPartial={setDraft} onFinal={(t) => submit(t, 'voice')} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 6 },
  brand: { fontSize: 20, fontWeight: '800', color: C.ink, letterSpacing: -0.4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  scenario: { fontSize: 11, fontWeight: '800', color: C.white, backgroundColor: C.refuse, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  busy: { marginLeft: 'auto', fontSize: 12, color: C.muted },
  list: { paddingHorizontal: 16, paddingBottom: 12, gap: 6 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: C.ink, borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '85%' },
  userText: { color: C.white, fontSize: 15, lineHeight: 21 },
  assistantText: { color: C.ink, fontSize: 15, lineHeight: 22 },
  error: { color: C.refuse, fontSize: 13 },
  hint: { color: C.muted, fontSize: 14 },
  example: { borderWidth: 1, borderColor: C.line, backgroundColor: C.card, borderRadius: 12, padding: 10 },
  exampleText: { color: C.ink, fontSize: 14 },
  composer: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.paper },
  input: { flex: 1, backgroundColor: C.white, borderRadius: 22, paddingHorizontal: 16, fontSize: 15, color: C.ink, minHeight: 44 },
});
