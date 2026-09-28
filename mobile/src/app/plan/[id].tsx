import { router, useLocalSearchParams } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { ActionBar, Refine, SafetyChecks, Sources, Timeline } from '@/components/plan/sections';
import { ElevationChart } from '@/components/trail/elevation-chart';
import { TrailHero } from '@/components/trail/trail-hero';
import { TrailImage } from '@/components/trail/trail-image';
import { TrailMap, type MapTrack } from '@/components/trail/trail-map';
import { Button, Card, Chip, Icon, ListRow, ListSection, Press, SectionTitle, StatRow, T } from '@/components/ui';
import { REFUSAL_LABEL, difficultyTone, radius, shortDate, useTheme } from '@/constants/theme';
import { checksBefore, useAgent } from '@/lib/agent';
import { fmtHours, fmtKm, fmtM, trailRoute, trailTitle } from '@/lib/format';
import { useRecent } from '@/lib/recent';
import { speakOutcome } from '@/lib/speech';
import { useTrailDetail, useTrails } from '@/lib/trails';
import type { Outcome, Refusal, TripPlan } from '@/lib/types';

/** Resolve a plan/refusal by id: saved on the device, or still only in this conversation. */
function useOutcome(id: string): Outcome | undefined {
  const { get } = useRecent();
  const { items } = useAgent();
  const saved = get(id);
  if (saved) return saved;
  const it = items.find((x) => x.id === id);
  if (it?.kind === 'plan') return { id, kind: 'plan', plan: it.plan, checks: checksBefore(items, id), savedAt: 0 };
  if (it?.kind === 'refusal') return { id, kind: 'refusal', refusal: it.refusal, checks: checksBefore(items, id), savedAt: 0 };
}

/** Send a follow-up to the agent and return to the conversation. */
function useFollowUp() {
  const agent = useAgent();
  return (text: string) => {
    if (!agent.send(text)) agent.setDraft(text);
    router.dismissTo('/chat');
  };
}

export default function PlanPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const o = useOutcome(id);
  const { c } = useTheme();
  if (!o) {
    return (
      <View style={[styles.missing, { backgroundColor: c.bg }]}>
        <Icon name="questionmark.folder" size={34} color="text3" />
        <T v="headline">This plan is no longer on this phone</T>
      </View>
    );
  }
  return o.kind === 'plan' ? <GoPage id={o.id} plan={o.plan} checks={o.checks} /> : <NoGoPage refusal={o.refusal} checks={o.checks} />;
}

function GoPage({ id, plan, checks }: { id: string; plan: TripPlan; checks: Outcome['checks'] }) {
  const { c } = useTheme();
  const { byId } = useTrails();
  const { trackFor } = useAgent();
  const followUp = useFollowUp();
  const p = plan.primary;
  const meta = byId[p.id];
  const { trail } = useTrailDetail(p.id);
  const { trail: backupTrail } = useTrailDetail(plan.backup?.id);
  const segments = trackFor(p.id)?.segments ?? trail?.segments;
  const profile = p.profile ?? trail?.profile;
  const diff = meta ? difficultyTone(meta.difficulty, c) : null;
  const y = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    y.value = e.contentOffset.y;
  });

  const tracks: MapTrack[] = [
    ...(segments ? [{ id: p.id, name: p.name, role: 'primary' as const, segments }] : []),
    ...(plan.backup && backupTrail ? [{ id: plan.backup.id, name: plan.backup.name, role: 'backup' as const, segments: backupTrail.segments }] : []),
  ];
  const directions = () => {
    const to = p.start_coord ? p.start_coord.join(',') : encodeURIComponent(`${p.start ?? p.name}, Hong Kong`);
    Linking.openURL(`https://maps.apple.com/?daddr=${to}&dirflg=r`);
  };

  return (
    <View style={[styles.flex, { backgroundColor: c.bg }]}>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.scroll}>
        <TrailHero
          id={p.id}
          segments={segments}
          scrollY={y}
          title={trailTitle({ name: p.name, trail: meta?.trail, section: meta?.section })}
          subtitle={[meta?.region, diff?.label, trailRoute(meta ?? {})].filter(Boolean).join(' · ')}
          badge={<Chip tone="accent" icon="checkmark" label={`Go · ${shortDate(plan.date)}`} />}
        />
        <View style={[styles.body, { backgroundColor: c.bg }]}>
          <T v="body">{plan.why_this}</T>

          <StatRow
            items={[
              { value: fmtKm(p.length_km), unit: 'km', label: 'Length' },
              { value: fmtHours(p.hours), label: 'Official time' },
              { value: fmtM(profile?.ascent_m), unit: 'm', label: 'Climb' },
              { value: fmtM(profile?.max_m), unit: 'm', label: 'High point' },
            ]}
          />

          <SafetyChecks checks={checks} plan={plan} />

          <Timeline steps={plan.timeline} />

          {profile ? (
            <Card style={styles.pad}>
              <ElevationChart profile={profile} />
            </Card>
          ) : null}

          {tracks.length ? (
            <View>
              <SectionTitle>Route</SectionTitle>
              <Press onPress={() => router.push({ pathname: '/map', params: { plan: id } })} accessibilityRole="button" accessibilityLabel="Open the map">
                <TrailMap tracks={tracks} interactive={false} padding={{ top: 30, right: 30, bottom: 30, left: 30 }} style={styles.preview} />
                <View style={styles.expand}>
                  <Chip tone="glass" icon="arrow.up.left.and.arrow.down.right" label="Open map" />
                </View>
              </Press>
            </View>
          ) : null}

          {plan.backup ? (
            <ListSection title="If plans change">
              <ListRow
                leading={<TrailImage id={plan.backup.id} size="thumb" style={styles.thumb} />}
                title={trailTitle({ name: plan.backup.name, trail: byId[plan.backup.id]?.trail, section: byId[plan.backup.id]?.section })}
                subtitle={`Backup · ${fmtKm(plan.backup.length_km)} km · ${fmtHours(plan.backup.hours)}`}
                accessory="chevron"
                onPress={() => router.push(`/trail/${plan.backup!.id}`)}
              />
            </ListSection>
          ) : null}

          {plan.why_not.length ? (
            <ListSection title="Ruled out" inset={52}>
              {plan.why_not.map((w) => (
                <ListRow
                  key={w.trail_id}
                  icon="xmark.circle"
                  iconColor="danger"
                  title={byId[w.trail_id] ? trailTitle(byId[w.trail_id]) : w.trail_id}
                  subtitle={w.reason}
                  subtitleLines={3}
                />
              ))}
            </ListSection>
          ) : null}

          <Refine
            options={[
              { label: 'Shorter', icon: 'arrow.down.right.and.arrow.up.left', ask: 'Can you find something shorter?' },
              { label: 'Less climbing', icon: 'arrow.down.forward', ask: 'Something with less climbing, please.' },
              { label: 'Finish earlier', icon: 'clock.arrow.circlepath', ask: 'I need to finish earlier. What works?' },
              { label: 'Somewhere else', icon: 'map', ask: 'Suggest somewhere else instead.' },
            ]}
            onPick={followUp}
          />

          <Sources items={plan.citations} />
        </View>
      </Animated.ScrollView>
      <ActionBar>
        <Button title="Directions" icon="tram.fill" onPress={directions} style={styles.flex} />
        <Button icon="speaker.wave.2.fill" variant="secondary" onPress={() => speakOutcome({ kind: 'plan', plan })} accessibilityLabel="Read the plan aloud" />
      </ActionBar>
    </View>
  );
}

function NoGoPage({ refusal, checks }: { refusal: Refusal; checks: Outcome['checks'] }) {
  const { c } = useTheme();
  const { byId } = useTrails();
  const followUp = useFollowUp();
  const first = refusal.trail_ids[0];
  const y = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    y.value = e.contentOffset.y;
  });
  const badge = <Chip tone="stop" icon="hand.raised.fill" label={`No-go · ${shortDate(refusal.date)}`} />;
  const reason = REFUSAL_LABEL[refusal.code] ?? refusal.code.replace(/_/g, ' ');

  return (
    <View style={[styles.flex, { backgroundColor: c.bg }]}>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.scroll}>
        {first ? (
          <TrailHero id={first} scrollY={y} height={320} title={byId[first] ? trailTitle(byId[first]) : first} subtitle={byId[first]?.region} badge={badge} />
        ) : (
          <View style={[styles.plainHero, { backgroundColor: c.dangerSoft }]}>
            {badge}
            <T v="title">{reason}</T>
          </View>
        )}
        <View style={[styles.body, { backgroundColor: c.bg }]}>
          <View style={styles.verdict}>
            <T v="footnote" color="danger" weight="600">
              {reason}
            </T>
            <T v="title3">{refusal.summary}</T>
            {refusal.counterfactual ? (
              <View style={styles.instead}>
                <Icon name="arrow.turn.down.right" size={16} color="text2" />
                <T v="body" color="text2" style={styles.flex}>
                  {refusal.counterfactual}
                </T>
              </View>
            ) : null}
          </View>

          <SafetyChecks checks={checks} />

          <Refine
            options={[
              { label: 'Another day', icon: 'calendar', ask: 'What about another day?' },
              { label: 'Something safer', icon: 'shield.lefthalf.filled', ask: 'Is there a safer alternative that works?' },
            ]}
            onPick={followUp}
          />

          <Sources items={refusal.evidence} title="Evidence" />
        </View>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingBottom: 120 },
  body: { padding: 16, paddingTop: 20, gap: 30 },
  pad: { padding: 16 },
  preview: { height: 200, borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden' },
  expand: { position: 'absolute', right: 10, bottom: 10 },
  thumb: { width: 52, height: 52, borderRadius: 10, borderCurve: 'continuous' },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  plainHero: { paddingTop: 120, paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  verdict: { gap: 8 },
  instead: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
