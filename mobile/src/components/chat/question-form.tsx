import { Fragment, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Icon, Press, T, hairline } from '@/components/ui';
import { radius, useTheme } from '@/constants/theme';
import type { CardAnswer, QuestionCard } from '@/lib/types';

/**
 * The agent's clarifying questions as a short form (tap, don't type), kept visually apart from its answers.
 * Once answered it folds to one line; typing in the composer instead answers it too.
 */
export function QuestionForm({ cards, answered, onSubmit }: { cards: QuestionCard[]; answered?: CardAnswer[]; onSubmit: (a: CardAnswer[]) => void }) {
  const { c } = useTheme();
  const [values, setValues] = useState<Record<string, string | string[]>>({});

  if (answered) {
    const summary = answered.length ? answered.map((a) => (Array.isArray(a.value) ? a.value.join(', ') : a.value)).join(' · ') : 'Answered in the chat';
    return (
      <View style={styles.folded}>
        <Icon name="checkmark.circle.fill" size={15} color="accent" />
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
            <Card>
              {(q.options ?? []).map((opt, i) => {
                const v = values[q.id];
                const on = Array.isArray(v) ? v.includes(opt) : v === opt;
                return (
                  <Fragment key={opt}>
                    {i > 0 && <View style={[styles.rule, { backgroundColor: c.separator }]} />}
                    <Press onPress={() => toggle(q, opt)} style={styles.option} accessibilityRole={q.type === 'single' ? 'radio' : 'checkbox'} accessibilityState={{ checked: on }}>
                      <T v="body" style={styles.shrink}>
                        {opt}
                      </T>
                      {q.type === 'multi' ? (
                        <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={20} color={on ? 'accent' : 'text3'} />
                      ) : on ? (
                        <Icon name="checkmark" size={16} weight="semibold" color="accent" />
                      ) : null}
                    </Press>
                  </Fragment>
                );
              })}
            </Card>
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
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 48 },
  rule: { height: hairline, marginLeft: 16 },
  folded: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  shrink: { flexShrink: 1, flexGrow: 1 },
});
