import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { C, TOOL_LABEL } from '@/constants/palette';
import type { CardAnswer, ChatItem, Citation, QuestionCard, Refusal, TripPlan } from '@/lib/types';

type ToolsItem = Extract<ChatItem, { kind: 'tools' }>;

const STATUS_ICON = { start: '…', ok: '✓', error: '!', blocked: '⛔', waiting: '?' } as const;

export function ToolChips({ item }: { item: ToolsItem }) {
  return (
    <View style={styles.chips}>
      {item.steps.map((s) => (
        <View key={s.call_id} style={[styles.chip, s.status === 'blocked' && styles.chipBlocked, s.status === 'error' && styles.chipError]}>
          <Text style={styles.chipText} numberOfLines={1}>
            {STATUS_ICON[s.status]} {TOOL_LABEL[s.name] ?? s.name}
            {s.summary && s.status !== 'start' ? ` · ${s.summary}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function QuestionCards({
  cards,
  answered,
  onSubmit,
}: {
  cards: QuestionCard[];
  answered?: CardAnswer[];
  onSubmit: (answers: CardAnswer[]) => void;
}) {
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const locked = Boolean(answered);
  const shown = answered ? Object.fromEntries(answered.map((a) => [a.id, a.value])) : values;
  const complete = cards.every((c) => {
    const v = values[c.id];
    return Array.isArray(v) ? v.length > 0 : Boolean(v && String(v).trim());
  });

  const toggle = (card: QuestionCard, option: string) => {
    if (locked) return;
    setValues((prev) => {
      if (card.type === 'single') return { ...prev, [card.id]: option };
      const cur = (prev[card.id] as string[] | undefined) ?? [];
      return { ...prev, [card.id]: cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option] };
    });
  };

  return (
    <View style={[styles.card, styles.askCard]}>
      {cards.map((card) => (
        <View key={card.id} style={styles.question}>
          <Text style={styles.qPrompt}>{card.prompt}</Text>
          {card.type === 'text' ? (
            <TextInput
              editable={!locked}
              style={styles.qInput}
              placeholder="Type your answer"
              placeholderTextColor={C.muted}
              value={String(shown[card.id] ?? '')}
              onChangeText={(t) => setValues((p) => ({ ...p, [card.id]: t }))}
            />
          ) : (
            <View style={styles.options}>
              {(card.options ?? []).map((opt) => {
                const v = shown[card.id];
                const on = Array.isArray(v) ? v.includes(opt) : v === opt;
                return (
                  <Pressable key={opt} onPress={() => toggle(card, opt)} style={[styles.option, on && styles.optionOn]}>
                    <Text style={[styles.optionText, on && styles.optionTextOn]}>{opt}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      ))}
      {!locked && (
        <Pressable
          disabled={!complete}
          onPress={() => onSubmit(cards.map((c) => ({ id: c.id, value: values[c.id] })))}
          style={[styles.primaryBtn, !complete && { opacity: 0.4 }]}>
          <Text style={styles.primaryBtnText}>Continue</Text>
        </Pressable>
      )}
    </View>
  );
}

function Citations({ items }: { items: Citation[] }) {
  return (
    <View style={styles.citations}>
      {items.map((c, i) => {
        const url = c.ref.startsWith('http') ? c.ref : null;
        return (
          <Text key={i} style={[styles.citation, url && styles.link]} onPress={url ? () => Linking.openURL(url) : undefined}>
            [{i + 1}] {c.source}: “{c.quote}”
          </Text>
        );
      })}
    </View>
  );
}

const stars = (n?: number | null) => {
  const k = Math.min(5, Math.max(0, Math.round(n ?? 0)));
  return k ? '★'.repeat(k) + '☆'.repeat(5 - k) : '';
};

export function PlanCard({ plan }: { plan: TripPlan }) {
  const p = plan.primary;
  // Route to the trail's start point, not its name (which geocodes to somewhere arbitrary along it).
  const destination = p.start_coord ? p.start_coord.join(',') : `${p.start ?? p.name}, Hong Kong`;
  const transit = `https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=${encodeURIComponent(destination)}`;
  return (
    <View style={[styles.card, styles.planCard]}>
      <Text style={styles.kicker}>GO · {plan.date}</Text>
      <Text style={styles.title}>{p.name}</Text>
      <Text style={styles.meta}>
        {p.length_km} km · {p.hours} h official{p.stars ? ` · ${stars(p.stars)}` : ''}
      </Text>
      <Text style={styles.body}>{plan.why_this}</Text>
      <View style={styles.timeline}>
        {plan.timeline.map((s, i) => (
          <View key={i} style={styles.step}>
            <Text style={styles.stepTime}>
              {s.start}–{s.end}
            </Text>
            <Text style={styles.stepLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.finish}>
        Finish {plan.finish_time} · Sunset {plan.sunset}
      </Text>
      <Text style={styles.body}>{plan.weather_summary}</Text>
      {plan.backup && (
        <Text style={styles.body}>
          Backup: <Text style={{ fontWeight: '700' }}>{plan.backup.name}</Text> ({plan.backup.length_km} km · {plan.backup.hours} h)
        </Text>
      )}
      {plan.why_not.map((w) => (
        <Text key={w.trail_id} style={styles.whyNot}>
          Not {w.trail_id}: {w.reason}
        </Text>
      ))}
      <Pressable onPress={() => Linking.openURL(transit)} style={styles.secondaryBtn}>
        <Text style={styles.secondaryBtnText}>Transit in Google Maps</Text>
      </Pressable>
      <Citations items={plan.citations} />
    </View>
  );
}

export function RefusalCard({ refusal }: { refusal: Refusal }) {
  return (
    <View style={[styles.card, styles.refusalCard]}>
      <Text style={[styles.kicker, { color: C.refuse }]}>NO-GO · {refusal.code.replace(/_/g, ' ')}</Text>
      <Text style={styles.title}>{refusal.summary}</Text>
      {refusal.counterfactual && <Text style={styles.body}>Instead: {refusal.counterfactual}</Text>}
      <Citations items={refusal.evidence} />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 4 },
  chip: { borderWidth: 1, borderColor: C.line, backgroundColor: C.card, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, maxWidth: '100%' },
  chipBlocked: { borderColor: C.refuse, backgroundColor: '#fde8e3' },
  chipError: { borderColor: C.post },
  chipText: { fontSize: 12, color: C.ink, fontVariant: ['tabular-nums'] },
  card: { borderRadius: 14, padding: 14, marginVertical: 6, borderWidth: 2, borderColor: C.ink, backgroundColor: C.white, gap: 6 },
  askCard: { backgroundColor: C.card },
  planCard: { backgroundColor: '#eef6e9' },
  refusalCard: { backgroundColor: '#fdf0ec', borderColor: C.refuse },
  question: { gap: 8, marginBottom: 6 },
  qPrompt: { fontSize: 15, fontWeight: '700', color: C.ink },
  qInput: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, fontSize: 15, color: C.ink, backgroundColor: C.white },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { borderWidth: 1.5, borderColor: C.moss, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  optionOn: { backgroundColor: C.moss },
  optionText: { color: C.moss, fontSize: 14, fontWeight: '600' },
  optionTextOn: { color: C.white },
  primaryBtn: { backgroundColor: C.ink, borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: C.white, fontWeight: '700', fontSize: 15 },
  secondaryBtn: { borderWidth: 1.5, borderColor: C.ink, borderRadius: 10, paddingVertical: 9, alignItems: 'center', marginTop: 4 },
  secondaryBtnText: { color: C.ink, fontWeight: '700' },
  kicker: { fontSize: 11, letterSpacing: 1.4, fontWeight: '700', color: C.water },
  title: { fontSize: 18, fontWeight: '800', color: C.ink },
  meta: { fontSize: 13, color: C.muted, fontVariant: ['tabular-nums'] },
  body: { fontSize: 14, color: C.ink, lineHeight: 20 },
  timeline: { borderLeftWidth: 3, borderLeftColor: C.post, paddingLeft: 10, gap: 4, marginVertical: 4 },
  step: { flexDirection: 'row', gap: 8 },
  stepTime: { fontSize: 13, fontWeight: '700', color: C.ink, width: 92, fontVariant: ['tabular-nums'] },
  stepLabel: { fontSize: 13, color: C.ink, flex: 1 },
  finish: { fontSize: 14, fontWeight: '700', color: C.moss, fontVariant: ['tabular-nums'] },
  whyNot: { fontSize: 13, color: C.refuse },
  citations: { gap: 2, marginTop: 4 },
  citation: { fontSize: 11, color: C.muted },
  link: { textDecorationLine: 'underline', color: C.water },
});
