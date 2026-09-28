import { StyleSheet, View } from 'react-native';

import { Card, Press, T } from '@/components/ui';
import { difficultyTone, radius, useTheme } from '@/constants/theme';
import { fmtHours, fmtKm, trailRoute, trailTitle } from '@/lib/format';
import type { TrailSummary } from '@/lib/types';

import { TrailImage } from './trail-image';

/** Difficulty as a coloured dot plus the word, then the numbers. */
export function TrailMeta({ t }: { t: TrailSummary }) {
  const { c } = useTheme();
  const d = difficultyTone(t.difficulty, c);
  return (
    <View style={styles.meta}>
      <View style={[styles.dot, { backgroundColor: d.color }]} />
      <T v="footnote" color="text2" style={styles.tabular} numberOfLines={1}>
        {d.label} · {fmtKm(t.length_km)} km · {fmtHours(t.hours)}
        {t.ascent_m != null ? ` · ${t.ascent_m} m climb` : ''}
      </T>
    </View>
  );
}

export function TrailRow({ t, note, onPress }: { t: TrailSummary; note?: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} style={styles.row} accessibilityRole="button" accessibilityLabel={trailTitle(t)}>
      <TrailImage id={t.id} size="thumb" style={styles.thumb} />
      <View style={styles.text}>
        <T v="headline" numberOfLines={2}>
          {trailTitle(t)}
        </T>
        <T v="footnote" color="text2" numberOfLines={1}>
          {note ? `${note} · ${trailRoute(t) ?? t.region}` : (trailRoute(t) ?? t.region)}
        </T>
        <TrailMeta t={t} />
      </View>
    </Press>
  );
}

/** The first result, larger, so the list isn't a wall of identical rows. */
export function TrailFeature({ t, note, onPress }: { t: TrailSummary; note?: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={trailTitle(t)}>
      <Card>
        <TrailImage id={t.id} size="hero" style={styles.feature} />
        <View style={styles.featureText}>
          <T v="caption" color="text2">
            {note ? `${t.region} · ${note}` : t.region}
          </T>
          <T v="title3">{trailTitle(t)}</T>
          <TrailMeta t={t} />
        </View>
      </Card>
    </Press>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 8 },
  thumb: { width: 88, height: 88, borderRadius: 14, borderCurve: 'continuous' },
  text: { flex: 1, gap: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  tabular: { fontVariant: ['tabular-nums'], flexShrink: 1 },
  feature: { aspectRatio: 16 / 9, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  featureText: { padding: 16, gap: 4 },
});
