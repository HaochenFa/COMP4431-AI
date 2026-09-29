import * as WebBrowser from 'expo-web-browser';
import type { SFSymbol } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, Glass, Icon, ListRow, ListSection, Press, SectionTitle, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { trailTitle } from '@/lib/format';
import { useTrails } from '@/lib/trails';
import type { Citation, ToolStep, TripPlan } from '@/lib/types';
import { warningName } from '@/lib/warnings';

const CHECK: Record<string, { label: string; icon: SFSymbol }> = {
  check_closures: { label: 'AFCD closures', icon: 'exclamationmark.octagon' },
  get_weather: { label: 'HKO forecast', icon: 'cloud.sun' },
  get_daylight: { label: 'Daylight', icon: 'sunset' },
};

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
          ? "Trailhead can't give a plan until these checks pass. The server enforces it, not just the prompt."
          : 'Trailhead can only call a no-go with evidence from these checks. The server enforces it, not just the prompt.'
      }>
      {rows.map((s) => {
        const meta = CHECK[s.name];
        const summary = s.summary ?? '';
        const bad =
          (s.name === 'check_closures' && /^closed/i.test(summary)) || (s.name === 'get_weather' && /^WARNING/.test(summary));
        let detail = summary;
        if (s.name === 'check_closures')
          detail = /^closed:\s*/i.test(summary)
            ? `Closed: ${summary.replace(/^closed:\s*/i, '').split(/,\s*/).map(name).join(', ')}`
            : summary === 'no closures'
              ? 'No closures on this route'
              : summary;
        if (s.name === 'get_weather')
          // The tool's one-line summary is capped at 80 chars; drop its "(warnings now, not on <date>)" tail.
          detail = /^WARNING /.test(summary)
            ? `In force: ${summary.slice(8).split(/,\s*/).map(warningName).join(', ')}`
            : summary.replace(/\s*\(warnings now.*$/, '');
        if (s.name === 'get_daylight') detail = plan ? `Sunset ${plan.sunset} · you finish by ${plan.finish_time}` : summary.replace(/^sunset/, 'Sunset');
        const [icon, color] =
          s.status === 'error'
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
