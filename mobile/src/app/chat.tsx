import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityRow, Thinking } from '@/components/chat/activity-row';
import { Composer } from '@/components/chat/composer';
import { MessageText } from '@/components/chat/message-text';
import { QuestionForm } from '@/components/chat/question-form';
import { PlanResult, RefusalResult } from '@/components/chat/result-card';
import { Icon, ListRow, ListSection, T } from '@/components/ui';
import { Logo } from '@/components/ui/logo';
import { useTheme } from '@/constants/theme';
import { useAgent } from '@/lib/agent';
import { PROMPTS } from '@/lib/ask';
import { scenarioLabel } from '@/lib/scenarios';
import type { ChatItem } from '@/lib/types';

export default function Chat() {
  const { c } = useTheme();
  const agent = useAgent();
  const insets = useSafeAreaInsets();
  const { listen } = useLocalSearchParams<{ listen?: string }>();
  const list = useRef<FlatList<ChatItem>>(null);
  const [keyboard, setKeyboard] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const send = (text: string, source: 'text' | 'voice' = 'text') => {
    if (agent.send(text, source)) agent.setDraft('');
  };

  const last = agent.items[agent.items.length - 1];
  const toolRunning = last?.kind === 'tools' && last.steps.some((s) => s.status === 'start');
  const thinking = agent.busy && !toolRunning && last?.kind !== 'assistant';

  const renderItem = ({ item }: { item: ChatItem }) => {
    switch (item.kind) {
      case 'user':
        return (
          <View style={[styles.user, { backgroundColor: c.surface2 }]}>
            {item.source === 'voice' && <Icon name="waveform" size={13} color="text2" />}
            <T v="body" style={styles.shrink}>
              {item.text}
            </T>
          </View>
        );
      case 'assistant':
        return <MessageText text={item.text} />;
      case 'tools':
        return <ActivityRow steps={item.steps} />;
      case 'ask':
        return <QuestionForm cards={item.cards} answered={item.answered} onSubmit={(a) => agent.answer(item.call_id, a)} />;
      case 'plan':
        return <PlanResult plan={item.plan} onOpen={() => router.push(`/plan/${item.id}`)} />;
      case 'refusal':
        return <RefusalResult refusal={item.refusal} onOpen={() => router.push(`/plan/${item.id}`)} />;
      case 'error':
        return (
          <View style={styles.error}>
            <Icon name="exclamationmark.triangle.fill" size={15} color="danger" />
            <T v="subhead" color="danger" style={styles.shrink}>
              {item.message}
            </T>
          </View>
        );
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerTitle: () => <ChatTitle /> }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="square.and.pencil" onPress={agent.newConversation} accessibilityLabel="New conversation" />
      </Stack.Toolbar>
      <KeyboardAvoidingView behavior="padding" style={[styles.flex, { backgroundColor: c.bg }]}>
        <FlatList
          ref={list}
          data={agent.items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => agent.items.length && list.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={<Empty onPick={(t) => send(t)} />}
          ListFooterComponent={thinking ? <Thinking /> : null}
        />
        <View style={[styles.composer, { paddingBottom: keyboard ? 8 : Math.max(insets.bottom, 12) }]}>
          <Composer
            value={agent.draft}
            onChange={agent.setDraft}
            onSend={() => send(agent.draft)}
            onVoice={(t) => send(t, 'voice')}
            placeholder={!agent.connected ? 'Connecting…' : agent.waitingFor ? 'Answer above, or type here' : 'Where do you want to hike?'}
            disabled={!agent.connected}
            listenOnMount={listen === '1'}
            autoFocus={Boolean(agent.draft) && listen !== '1'}
          />
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

function ChatTitle() {
  const { scenario, connected, model } = useAgent();
  // OpenRouter ids carry the vendor ("x-ai/grok-4.6"); the model name alone is enough here.
  const sub = !connected ? 'Connecting…' : scenario !== 'live' ? `Demo · ${scenarioLabel(scenario)}` : model?.split('/').pop();
  return (
    <View style={styles.title}>
      <T v="headline">Trailhead</T>
      {sub ? (
        <T v="caption" color={connected && scenario !== 'live' ? 'caution' : 'text2'} numberOfLines={1}>
          {sub}
        </T>
      ) : null}
    </View>
  );
}

function Empty({ onPick }: { onPick: (text: string) => void }) {
  return (
    <View style={styles.empty}>
      <View style={styles.mark}>
        <Logo size={52} />
      </View>
      <T v="title">Plan a hike</T>
      <T v="body" color="text2">
        Tell me the day, how long you have and what you would like to see. Before I suggest anything, I check AFCD closures, the HKO
        forecast and sunset.
      </T>
      <ListSection inset={52} style={styles.prompts}>
        {PROMPTS.map((p) => (
          <ListRow key={p.text} icon={p.icon} iconColor="accentInk" title={p.title} subtitle={p.detail} onPress={() => onPick(p.text)} />
        ))}
      </ListSection>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 14 },
  shrink: { flexShrink: 1 },
  user: {
    alignSelf: 'flex-end',
    maxWidth: '84%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderCurve: 'continuous',
  },
  error: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  composer: { paddingHorizontal: 12, paddingTop: 6 },
  title: { alignItems: 'center', maxWidth: 240 },
  empty: { paddingTop: 24, gap: 12 },
  mark: { marginBottom: 6 },
  prompts: { marginTop: 12 },
});
