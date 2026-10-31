import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button, Icon, Press, T } from '@/components/ui';
import { radius, useTheme } from '@/constants/theme';
import type { CardAnswer, QuestionCard } from '@/lib/types';

/**
 * The agent's clarifying questions as a short form (tap, don't type), kept visually apart from its answers.
 * Options wrap as chips, so three questions and Continue fit on one screen.
 * Once answered it folds to one line; typing in the composer instead answers it too.
 */
export function QuestionForm({ cards, answered, onSubmit }: { cards: QuestionCard[]; answered?: CardAnswer[]; onSubmit: (a: CardAnswer[]) => void }) {
  const { c } = useTheme();
  const [values, setValues] = useState<Record<string, string | string[]>>({});

  if (answered) {
    const summary = answered.length ? answered.map((a) => (Array.isArray(a.value) ? a.value.join(', ') : a.value)).join(' · ') : 'Answered in the chat';
    return (
      <View style={styles.folded}>
        <Icon name="checkmark.circle.fill" size={15} color="accentInk" />
        <T v="subhead" color="text2" style={styles.shrink} numberOfLines={2}>
          {summary}
        </T>
      </View>
    );
  }

  const complete = cards.every((q) => {
    const v = values[q.id];
    return Array.isArray(v) ? v.length > 0 : Boolean(v && String(v).trim());
  });

  const toggle = (q: QuestionCard, option: string) =>
    setValues((prev) => {
      if (q.type === 'single') return { ...prev, [q.id]: option };
      const cur = (prev[q.id] as string[] | undefined) ?? [];
      return { ...prev, [q.id]: cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option] };
    });

  return (
    <View style={styles.form}>
      {cards.map((q) => (
        <View key={q.id} style={styles.question}>
          <T v="headline">{q.prompt}</T>
          {q.type === 'multi' ? (
            <T v="footnote" color="text2">
              Choose any
            </T>
          ) : null}
          {q.type === 'text' ? (
            <TextInput
              style={[styles.input, { backgroundColor: c.surface, color: c.text }]}
              placeholder="Your answer"
              placeholderTextColor={c.text3}
              value={String(values[q.id] ?? '')}
              onChangeText={(t) => setValues((p) => ({ ...p, [q.id]: t }))}
            />
          ) : (
            <View style={styles.options}>
              {(q.options ?? []).map((opt) => {
                const v = values[q.id];
                const on = Array.isArray(v) ? v.includes(opt) : v === opt;
                return (
                  <Press
                    key={opt}
                    onPress={() => toggle(q, opt)}
                    style={[styles.option, { backgroundColor: on ? c.text : c.surface2 }]}
                    accessibilityRole={q.type === 'single' ? 'radio' : 'checkbox'}
                    accessibilityState={{ checked: on }}>
                    <T v="subhead" color={on ? c.bg : c.text}>
                      {opt}
                    </T>
                  </Press>
                );
              })}
            </View>
          )}
        </View>
      ))}
      <Button title="Continue" disabled={!complete} onPress={() => onSubmit(cards.map((q) => ({ id: q.id, value: values[q.id] })))} />
      <T v="footnote" color="text3" center>
        Or type your own answer below
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16, paddingVertical: 6 },
  question: { gap: 8 },
  input: { borderRadius: radius.control + 2, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // The same size selected or not: a tap must not reflow the options under the finger.
  option: { justifyContent: 'center', paddingHorizontal: 14, minHeight: 44, borderRadius: 22, borderCurve: 'continuous', maxWidth: '100%' },
  folded: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  shrink: { flexShrink: 1, flexGrow: 1 },
});
