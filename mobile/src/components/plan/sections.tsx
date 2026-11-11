import * as WebBrowser from 'expo-web-browser';
import type { SFSymbol } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, Glass, Icon, ListRow, ListSection, Press, SectionTitle, T } from '@/components/ui';
import { shortDate, useTheme } from '@/constants/theme';
import { trailTitle } from '@/lib/format';
import { scenarioLabel } from '@/lib/scenarios';
import { useSettings } from '@/lib/settings';
import { speakOutcome, stopSpeaking, useSpeechState } from '@/lib/speech';
import { useTrails } from '@/lib/trails';
import type { BusStop, Citation, ToolStep, TrailAccess, TripPlan } from '@/lib/types';
import { warningName } from '@/lib/warnings';

const CHECK: Record<string, { label: string; icon: SFSymbol }> = {
  check_closures: { label: 'AFCD closures', icon: 'exclamationmark.octagon' },
  get_weather: { label: 'HKO forecast', icon: 'cloud.sun' },
  get_daylight: { label: 'Daylight', icon: 'sunset' },
};

/** Go, or Provisional when HKO has no forecast for the date yet. */
export function PlanChip({ plan, date = true }: { plan: TripPlan; date?: boolean }) {
  const when = date ? ` · ${shortDate(plan.date)}` : '';
  return plan.provisional ? <Chip tone="hold" icon="clock" label={`Provisional${when}`} /> : <Chip tone="accent" icon="checkmark" label={`Go${when}`} />;
}

/** Marks a plan or refusal that came from a demo scenario, wherever it is shown. */
export function DemoChip({ scenario }: { scenario?: string }) {
  return scenario ? <Chip tone="glass" icon="theatermasks" label={`Demo · ${scenarioLabel(scenario)}`} /> : null;
}

export function Badges({ children }: { children: ReactNode }) {
  return <View style={styles.badges}>{children}</View>;
}

/**
 * The safety gate made visible: the closure, weather and daylight checks the server requires (in code)
 * before it lets a plan or refusal through, with what each one returned.
 */
export function SafetyChecks({ checks, plan }: { checks: ToolStep[]; plan?: TripPlan }) {
  const { byId } = useTrails();
  const name = (id: string) => (byId[id] ? trailTitle(byId[id]) : id);

  // Plans saved before checks were recorded: the gate guarantees these passed, so say so from the plan.
  const rows: ToolStep[] = checks.length
    ? checks
    : plan
      ? [
          { call_id: 'c', name: 'check_closures', status: 'ok', summary: 'no closures' },
          { call_id: 'w', name: 'get_weather', status: 'ok', summary: plan.weather_summary },
          { call_id: 'd', name: 'get_daylight', status: 'ok', summary: `sunset ${plan.sunset}` },
        ]
      : [];
  if (!rows.length) return null;

  return (
    <ListSection
      title="Safety checks"
      inset={52}
      footer={
        plan
          ? "TrailAI can't give a plan until these checks pass. The server enforces it, not just the prompt."
          : 'TrailAI can only call a no-go with evidence from these checks. The server enforces it, not just the prompt.'
      }>
      {rows.map((s) => {
        const meta = CHECK[s.name];
        const summary = s.summary ?? '';
        const closed = /^closed:\s*/i.test(summary) ? summary.replace(/^closed:\s*/i, '').split(/,\s*/) : [];
        // On a plan only its own trails count: a candidate the agent dropped for being closed is the check working.
        const blocking = plan ? closed.filter((t) => t === plan.primary.id || t === plan.backup?.id) : closed;
        const bad = (s.name === 'check_closures' && blocking.length > 0) || (s.name === 'get_weather' && /^WARNING/.test(summary));
        const noForecast = s.name === 'get_weather' && /^beyond/.test(summary);
        let detail = summary;
        if (s.name === 'check_closures')
          detail = blocking.length ? `Closed: ${blocking.map(name).join(', ')}` : closed.length || summary === 'no closures' ? 'No closures on this route' : summary;
        if (s.name === 'get_weather')
          // A plan's line has HKO's temperatures and wind; otherwise the summary, less its "(warnings now, not on <date>)" tail.
          detail = /^WARNING /.test(summary)
            ? `In force: ${summary.slice(8).split(/,\s*/).map(warningName).join(', ')}`
            : plan?.weather_summary || summary.replace(/\s*\(warnings now.*$/, '');
        if (s.name === 'get_daylight') detail = plan ? `Sunset ${plan.sunset} · you finish by ${plan.finish_time}` : summary.replace(/^sunset/, 'Sunset');
        const [icon, color] =
          s.status === 'error' || noForecast
            ? (['exclamationmark.triangle.fill', 'caution'] as const)
            : bad
              ? (['xmark.octagon.fill', 'danger'] as const)
              : (['checkmark.circle.fill', 'accentInk'] as const);
        return (
          <ListRow
            key={s.name}
            icon={meta?.icon ?? 'checkmark.shield'}
            title={meta?.label ?? s.name}
            subtitle={detail}
            subtitleLines={3}
            accessory={<Icon name={icon} size={20} color={color} />}
          />
        );
      })}
    </ListSection>
  );
}

export function Timeline({ steps }: { steps: TripPlan['timeline'] }) {
  const { c } = useTheme();
  if (!steps.length) return null;
  return (
    <View>
      <SectionTitle>Your day</SectionTitle>
      {steps.map((s, i) => (
        <View key={i} style={styles.step}>
          <T v="subhead" color="text2" style={styles.time}>
            {s.start}–{s.end}
          </T>
          <View style={styles.rail}>
            <View style={[styles.dot, { backgroundColor: i === 0 ? c.accentInk : c.text2 }]} />
            {i < steps.length - 1 && <View style={[styles.line, { backgroundColor: c.separator }]} />}
          </View>
          <T v="body" style={styles.label}>
            {s.label}
          </T>
        </View>
      ))}
    </View>
  );
}

const MAX_ROUTES = 8;
const GMB = 'GMB ';

/** Route numbers as chips. A busy stop has up to 70 routes: show the first few and count the rest. */
function RouteChips({ routes }: { routes: string[] }) {
  const { c } = useTheme();
  const rest = routes.length - MAX_ROUTES;
  return (
    <View style={styles.routes}>
      {routes.slice(0, MAX_ROUTES).map((r) => (
        <View key={r} style={[styles.route, { backgroundColor: c.surface2 }]}>
          <T v="footnote" weight="600" style={styles.routeText}>
            {r}
          </T>
        </View>
      ))}
      {rest > 0 ? (
        <T v="footnote" color="text2">
          +{rest} more
        </T>
      ) : null}
    </View>
  );
}

/** The feed lists green minibuses with buses; a stop only they serve gets its own icon and label. */
function stopKind(routes: string[]): { icon: SFSymbol; label: string; routes: string[] } {
  const minibus = routes.filter((r) => r.startsWith(GMB));
  if (minibus.length === routes.length) return { icon: 'bus', label: 'Green minibus', routes: routes.map((r) => r.slice(GMB.length)) };
  return { icon: 'bus.doubledecker', label: minibus.length ? 'Bus and minibus' : 'Bus', routes };
}

/** Stops are listed up to 5 km out (backend MAX_M): metres up to 1 km, then km. */
function stopDistance(m: number) {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

function StopRows({ stops }: { stops: BusStop[] }) {
  if (!stops.length) return <ListRow icon="bus.doubledecker" iconColor="text3" title={<T color="text2">No bus stop within 5 km</T>} />;
  return stops.map((s) => {
    const kind = stopKind(s.routes);
    return (
      <ListRow
        key={`${s.name}-${s.distance_m}`}
        icon={kind.icon}
        title={s.name}
        titleLines={2}
        subtitle={`${stopDistance(s.distance_m)} away · ${kind.label}`}
        below={<RouteChips routes={kind.routes} />}
      />
    );
  });
}

/** "Getting there & back": the nearest bus stops to the trail's start and finish. Official data shown as is; the agent never names routes. */
export function AccessSection({ access }: { access?: TrailAccess | null }) {
  // No data, or no stop within range of either end: two "no bus stop" rows say nothing useful.
  if (!access || (!access.start.length && !access.finish.length)) return null;
  return (
    <View>
      <SectionTitle>Getting there & back</SectionTitle>
      <View style={styles.groups}>
        <View>
          <T v="footnote" color="text2" weight="600" style={styles.groupLabel}>
            Start
          </T>
          <ListSection inset={52}>
            <StopRows stops={access.start} />
          </ListSection>
        </View>
        <View>
          <T v="footnote" color="text2" weight="600" style={styles.groupLabel}>
            Finish
          </T>
          <ListSection
            inset={52}
            footer="Straight-line distances from the trail's start and finish. Source: Transport Department. Check routes and times with the operator before you go."
          >
            <StopRows stops={access.finish} />
          </ListSection>
        </View>
      </View>
    </View>
  );
}

/** "How this plan was made": collapsed by default, numbered official sources that open in-app. */
export function Sources({ items, title = 'How this plan was made' }: { items: Citation[]; title?: string }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <View>
      <Press onPress={() => setOpen((o) => !o)} style={styles.disclosure} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <T v="title3" style={styles.flex}>
          {title}
        </T>
        <T v="subhead" color="text2">
          {items.length} {items.length === 1 ? 'source' : 'sources'}
        </T>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} size={12} weight="semibold" color="text3" />
      </Press>
      {open && (
        <Animated.View entering={FadeIn.duration(160)}>
          <ListSection inset={16}>
            {items.map((cite, i) => {
              const url = cite.ref.startsWith('http') ? cite.ref : null;
              return (
                <ListRow
                  key={i}
                  leading={
                    <T v="footnote" color="text2" style={styles.index}>
                      {i + 1}
                    </T>
                  }
                  title={cite.source}
                  subtitle={`“${cite.quote}”`}
                  subtitleLines={4}
                  accessory={url ? 'link' : undefined}
                  onPress={url ? () => WebBrowser.openBrowserAsync(url) : undefined}
                />
              );
            })}
          </ListSection>
        </Animated.View>
      )}
    </View>
  );
}

/** One-tap follow-ups that go back to the conversation (AllTrails-style refinements, driven by the agent). */
export function Refine({ options, onPick }: { options: { label: string; icon: SFSymbol; ask: string }[]; onPick: (ask: string) => void }) {
  return (
    <View>
      <SectionTitle>Adjust this plan</SectionTitle>
      <View style={styles.chips}>
        {options.map((o) => (
          <Chip key={o.label} label={o.label} icon={o.icon} onPress={() => onPick(o.ask)} style={styles.chip} />
        ))}
      </View>
    </View>
  );
}

/** Reads the plan aloud; while it's reading (or the server is preparing the audio), tapping stops it. */
export function ReadAloudButton({ plan }: { plan: TripPlan }) {
  const { settings } = useSettings();
  const reading = useSpeechState();
  return (
    <Button
      icon={reading === 'idle' ? 'speaker.wave.2.fill' : 'stop.fill'}
      variant="secondary"
      onPress={() => (reading === 'idle' ? speakOutcome({ kind: 'plan', plan }, settings.voice, settings.backendUrl) : stopSpeaking())}
      accessibilityLabel={reading === 'idle' ? 'Read the plan aloud' : 'Stop reading'}
    />
  );
}

/** Floating glass bar for a page's one or two actions. */
export function ActionBar({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <Glass style={styles.bar}>{children}</Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  groups: { gap: 14 },
  groupLabel: { marginBottom: 6, marginLeft: 4 },
  routes: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 },
  route: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 7 },
  routeText: { fontVariant: ['tabular-nums'] },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  step: { flexDirection: 'row', gap: 12, minHeight: 44 },
  time: { width: 96, fontVariant: ['tabular-nums'], paddingTop: 1 },
  rail: { width: 12, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  line: { width: 2, flex: 1, marginTop: 4, marginBottom: -2 },
  label: { flex: 1, paddingBottom: 14 },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  index: { width: 20, textAlign: 'center', fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9 },
  barWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16 },
  bar: { flexDirection: 'row', gap: 10, padding: 8, borderRadius: 33 },
});
