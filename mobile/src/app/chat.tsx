import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
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
  // A ScrollView, not a FlatList: its scrollToEnd estimates from measured cells, so a plan that has just arrived stays below the fold.
  const list = useRef<ScrollView>(null);
  const [keyboard, setKeyboard] = useState(0);
  // Follow new messages, unless the user has scrolled up to read.
  const stick = useRef(true);

  // The screen runs to the bottom edge, so the composer clears the keyboard by exactly its height. KeyboardAvoidingView
  // goes through the header height instead, which is still a default when the keyboard rises during a push.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardWillChangeFrame', (e) => {
      if (e.duration) LayoutAnimation.configureNext({ duration: e.duration, update: { type: 'keyboard' } });
      setKeyboard(Math.max(Dimensions.get('window').height - e.endCoordinates.screenY, 0));
    });
    return () => sub.remove();
  }, []);

  const send = (text: string, source: 'text' | 'voice' = 'text') => {
    stick.current = true;
    if (agent.send(text, source)) agent.setDraft('');
  };

  const stickIfAtEnd = ({ nativeEvent: e }: NativeSyntheticEvent<NativeScrollEvent>) => {
    stick.current = e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height < 96;
  };

  const follow = () => {
    if (agent.items.length && stick.current) list.current?.scrollToEnd({ animated: true });
  };

  const last = agent.items[agent.items.length - 1];
  const toolRunning = last?.kind === 'tools' && last.steps.some((s) => s.status === 'start');
  // Text can stop well before the turn does: a plan is written out after the last sentence.
  const thinking = agent.busy && !toolRunning;

  const renderItem = (item: ChatItem) => {
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
        return (
          <QuestionForm
            cards={item.cards}
            answered={item.answered}
            onSubmit={(a) => {
              stick.current = true;
              agent.answer(item.call_id, a);
            }}
          />
        );
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
      <View style={[styles.flex, { backgroundColor: c.bg }]}>
        <ScrollView
          ref={list}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={() => (stick.current = false)}
          onScrollEndDrag={stickIfAtEnd}
          onMomentumScrollEnd={stickIfAtEnd}
          onContentSizeChange={follow}
          onLayout={follow}>
          {agent.items.length ? agent.items.map((item) => <Fragment key={item.id}>{renderItem(item)}</Fragment>) : <Empty onPick={(t) => send(t)} />}
          {thinking ? <Thinking label={agent.connected ? 'Thinking…' : 'Reconnecting…'} /> : null}
        </ScrollView>
        <View style={[styles.composer, { paddingBottom: keyboard ? keyboard + 8 : Math.max(insets.bottom, 12) }]}>
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
      </View>
    </>
  );
}

function ChatTitle() {
  const { scenario, connected, model } = useAgent();
  // OpenRouter ids carry the vendor ("x-ai/grok-4.6"); the model name alone is enough here.
  const sub = !connected ? 'Connecting…' : scenario !== 'live' ? `Demo · ${scenarioLabel(scenario)}` : model?.split('/').pop();
  return (
    <View style={styles.title}>
      <T v="headline">TrailAI</T>
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
