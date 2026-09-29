import { StyleSheet, View } from 'react-native';

import { TrailImage } from '@/components/trail/trail-image';
import { Card, Chip, Icon, Press, T, hairline } from '@/components/ui';
import { REFUSAL_LABEL, difficultyTone, shortDate, useTheme } from '@/constants/theme';
import { useAgent } from '@/lib/agent';
import { fmtHours, fmtKm, trailTitle } from '@/lib/format';
import { useTrails } from '@/lib/trails';
import type { Refusal, TripPlan } from '@/lib/types';

/** A plan in the chat: compact, one tap to the full plan page (at most one action, per inline-card practice). */
export function PlanResult({ plan, onOpen }: { plan: TripPlan; onOpen: () => void }) {
  const { c } = useTheme();
  const { byId } = useTrails();
  const { trackFor } = useAgent();
  const p = plan.primary;
  const t = byId[p.id];
  const diff = t ? difficultyTone(t.difficulty, c) : null;
  return (
    <Press onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open plan: ${p.name}`}>
      <Card>
        <TrailImage id={p.id} size="hero" scrim segments={trackFor(p.id)?.segments} style={styles.media}>
          <View style={styles.badge}>
            <Chip tone="accent" icon="checkmark" label={`Go · ${shortDate(plan.date)}`} />
          </View>
        </TrailImage>
        <View style={styles.body}>
          <T v="title3">{trailTitle({ name: p.name, trail: t?.trail, section: t?.section })}</T>
          {t ? (
            <View style={styles.meta}>
              <T v="subhead" color="text2">
                {t.region}
              </T>
              <View style={[styles.dot, { backgroundColor: diff!.color }]} />
              <T v="subhead" color="text2">
                {diff!.label}
              </T>
            </View>
          ) : null}
          <T v="subhead" style={styles.tabular}>
            {fmtKm(p.length_km)} km · {fmtHours(p.hours)}
            {p.profile ? ` · ${p.profile.ascent_m} m climb` : ''}
          </T>
          <View style={styles.meta}>
            <Icon name="flag.checkered" size={13} color="text2" />
            <T v="footnote" color="text2" style={styles.tabular}>
              Finish {plan.finish_time}
            </T>
            <Icon name="sunset" size={14} color="text2" />
            <T v="footnote" color="text2" style={styles.tabular}>
              Sunset {plan.sunset}
            </T>
          </View>
        </View>
        <View style={[styles.footer, { borderTopColor: c.separator }]}>
          <T v="subhead" color="accentInk" weight="600">
            View plan
          </T>
          <Icon name="chevron.right" size={12} weight="semibold" color="accentInk" />
        </View>
      </Card>
    </Press>
  );
}

/** A no-go: what rules it out, the alternative, and a way into the evidence. */
export function RefusalResult({ refusal, onOpen }: { refusal: Refusal; onOpen: () => void }) {
  const { c } = useTheme();
  return (
    <Press onPress={onOpen} accessibilityRole="button" accessibilityLabel={`No-go: ${refusal.summary}`}>
      <Card>
        <View style={styles.body}>
          <Chip tone="danger" icon="hand.raised.fill" label={`No-go · ${shortDate(refusal.date)}`} />
          <T v="footnote" color="danger" weight="600">
            {REFUSAL_LABEL[refusal.code] ?? refusal.code.replace(/_/g, ' ')}
          </T>
          {/* The card is the headline; the full reason and evidence are one tap away on the no-go page. */}
          <T v="headline" numberOfLines={4}>
            {refusal.summary}
          </T>
          {refusal.counterfactual ? (
            <View style={styles.instead}>
              <Icon name="arrow.turn.down.right" size={14} color="text2" />
              <T v="subhead" color="text2" style={styles.shrink} numberOfLines={3}>
                {refusal.counterfactual}
              </T>
            </View>
          ) : null}
        </View>
        <View style={[styles.footer, { borderTopColor: c.separator }]}>
          <T v="subhead" color="text" weight="600">
            Evidence · {refusal.evidence.length} {refusal.evidence.length === 1 ? 'source' : 'sources'}
          </T>
          <Icon name="chevron.right" size={12} weight="semibold" color="text2" />
        </View>
      </Card>
    </Press>
  );
}

const styles = StyleSheet.create({
  media: { aspectRatio: 16 / 9 },
  badge: { position: 'absolute', top: 12, left: 12 },
  body: { padding: 16, gap: 6 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  tabular: { fontVariant: ['tabular-nums'] },
  instead: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 2 },
  shrink: { flexShrink: 1 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderTopWidth: hairline,
  },
});
