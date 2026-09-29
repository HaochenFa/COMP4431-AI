import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { TrailImage } from '@/components/trail/trail-image';
import { Card, Chip, GlassButton, Icon, ListRow, ListSection, Press, SectionTitle, T } from '@/components/ui';
import { shortDate, useTheme } from '@/constants/theme';
import { useAgent } from '@/lib/agent';
import { PROMPTS, useAsk, weatherIcon } from '@/lib/ask';
import { trailTitle } from '@/lib/format';
import { useRecent } from '@/lib/recent';
import { scenarioLabel } from '@/lib/scenarios';
import { useConditions, useTrails } from '@/lib/trails';
import type { Outcome } from '@/lib/types';
import { describeWarning, sinceLabel } from '@/lib/warnings';

export default function Home() {
  const { c } = useTheme();
  const ask = useAsk();
  const { recent } = useRecent();
  const now = new Date();
  const weekend = now.getDay() === 0 || now.getDay() === 6;

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <View style={styles.top}>
        <T v="footnote" color="text2" weight="600">
          {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </T>
        <GlassButton icon="gearshape" onPress={() => router.push('/settings')} accessibilityLabel="Settings" />
      </View>
      <T v="largeTitle" style={styles.title}>
        {weekend ? 'Where to today?' : 'Where to this weekend?'}
      </T>

      <Outlook />

      <ListSection title="Ask Trailhead" inset={52}>
        {PROMPTS.map((p) => (
          <ListRow key={p.text} icon={p.icon} iconColor="accentInk" title={p.title} subtitle={p.detail} accessory="chevron" onPress={() => ask(p.text)} />
        ))}
      </ListSection>

      {recent.length > 0 && (
        <View>
          <SectionTitle>Recent plans</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recent} style={styles.bleed}>
            {recent.map((o) => (
              <RecentCard key={o.id} o={o} />
            ))}
          </ScrollView>
        </View>
      )}

      <T v="caption" color="text3" center>
        Trails and photos: AFCD · Weather and sunset: Hong Kong Observatory
      </T>
    </ScrollView>
  );
}

/** Today and the weekend from HKO, under the active demo scenario. Warnings in force lead, each with what it means on a trail. */
function Outlook() {
  const { c } = useTheme();
  const { conditions, failed } = useConditions();
  const { scenario } = useAgent();

  if (!conditions) {
    return (
      <Card style={styles.outlook}>
        <View style={styles.row}>
          <Icon name={failed ? 'wifi.exclamationmark' : 'cloud.sun'} size={18} color="text2" />
          <T v="subhead" color="text2" style={styles.shrink}>
            {failed ? "Can't reach the Trailhead server. Check the address in Settings." : 'Checking the Hong Kong Observatory…'}
          </T>
        </View>
      </Card>
    );
  }

  const noGoCodes = new Set(conditions.days.flatMap((d) => d.no_go ?? []));
  const warnings = Object.entries(conditions.warnings).map(([key, w]) => ({ ...describeWarning(key, w), noGo: noGoCodes.has(w.code ?? '') }));
  const noGoIcon = warnings.find((w) => w.noGo)?.icon;
  return (
    <Card style={styles.outlook}>
      {warnings.map((w) => {
        const since = sinceLabel(w.issued);
        return (
          <View key={w.key} style={[styles.warning, { borderBottomColor: c.separator }]}>
            <View style={styles.warningIcon}>
              <Icon name={w.icon} size={24} color={w.noGo ? 'danger' : 'caution'} mode={w.noGo ? 'hierarchical' : 'multicolor'} />
            </View>
            <View style={styles.shrink}>
              <T v="headline">{w.title}</T>
              <T v="footnote" color="text2">
                {since ? `${since} · ${w.advice}` : w.advice}
              </T>
            </View>
          </View>
        );
      })}
      <View style={styles.days}>
        {conditions.days.map((d, i) => {
          const noGo = Boolean(d.no_go?.length);
          return (
            <View key={d.date} style={styles.day} accessible accessibilityLabel={`${i === 0 ? 'Today' : shortDate(d.date)}: ${noGo ? 'no-go' : (d.summary ?? '')}`}>
              <T v="caption" color="text2">
                {i === 0 ? 'Today' : shortDate(d.date).split(' ')[0]}
              </T>
              {noGo && noGoIcon ? (
                <Icon name={noGoIcon} size={28} color="danger" mode="hierarchical" />
              ) : (
                <Icon name={weatherIcon(d.summary)} size={30} mode="multicolor" />
              )}
              <T v="subhead" weight="600" color={noGo ? 'danger' : 'text'} style={styles.tabular}>
                {noGo ? 'No-go' : d.max_c == null ? ' ' : d.min_c == null ? `High ${d.max_c}°` : `${d.min_c}–${d.max_c}°`}
              </T>
              <View style={styles.row}>
                <Icon name="sunset.fill" size={12} color="text3" />
                <T v="caption" color="text2" style={styles.tabular}>
                  {d.sunset ?? '–'}
                </T>
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.row}>
        <T v="caption" color="text3" style={styles.shrink}>
          Hong Kong Observatory
        </T>
        {scenario !== 'live' && <Chip tone="caution" icon="theatermasks" label={`Demo · ${scenarioLabel(scenario)}`} />}
      </View>
    </Card>
  );
}

function RecentCard({ o }: { o: Outcome }) {
  const { c } = useTheme();
  const { byId } = useTrails();
  const id = o.kind === 'plan' ? o.plan.primary.id : o.refusal.trail_ids[0];
  const t = id ? byId[id] : undefined;
  // Both kinds are titled by the trail; the chip on the photo already says Go or No-go.
  const title =
    o.kind === 'plan' ? trailTitle({ name: o.plan.primary.name, trail: t?.trail, section: t?.section }) : t ? trailTitle(t) : o.refusal.summary;
  const date = o.kind === 'plan' ? o.plan.date : o.refusal.date;
  return (
    <Press onPress={() => router.push(`/plan/${o.id}`)} style={styles.recentCard} accessibilityRole="button" accessibilityLabel={title}>
      {id ? (
        <TrailImage id={id} size="thumb" style={styles.recentImage}>
          <View style={styles.badge}>
            {o.kind === 'plan' ? <Chip tone="accent" icon="checkmark" label="Go" /> : <Chip tone="glass" icon="hand.raised.fill" label="No-go" />}
          </View>
        </TrailImage>
      ) : (
        <View style={[styles.recentImage, styles.noImage, { backgroundColor: c.dangerSoft }]}>
          <Icon name="hand.raised.fill" size={28} color="danger" />
        </View>
      )}
      <T v="subhead" weight="600" numberOfLines={2} style={styles.recentTitle}>
        {title}
      </T>
      <T v="caption" color="text2">
        {shortDate(date)}
      </T>
    </Press>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingBottom: 40, gap: 28 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: -20 },
  title: { marginTop: 0 },
  outlook: { padding: 16, gap: 14, marginTop: -8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1, flexGrow: 1 },
  warning: { flexDirection: 'row', gap: 12, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
  warningIcon: { marginTop: 2 },
  days: { flexDirection: 'row' },
  day: { flex: 1, alignItems: 'center', gap: 6 },
  tabular: { fontVariant: ['tabular-nums'] },
  bleed: { marginHorizontal: -16 },
  recent: { paddingHorizontal: 16, gap: 12 },
  recentCard: { width: 200, gap: 4 },
  recentImage: { width: 200, height: 125, borderRadius: 14, borderCurve: 'continuous', marginBottom: 6 },
  noImage: { alignItems: 'center', justifyContent: 'center' },
  recentTitle: { minHeight: 40 },
  badge: { position: 'absolute', top: 8, left: 8 },
});
