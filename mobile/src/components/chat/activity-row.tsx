import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Icon, Press, T } from '@/components/ui';
import { toolMeta, useTheme } from '@/constants/theme';
import type { ToolStep } from '@/lib/types';

/**
 * The agent's tool calls as one line: the task it is doing now ("Checking the HKO forecast for Sat 3 Oct…"),
 * collapsing to "Checked 4 sources" when done. Tap to see each source and what it returned.
 */
export function ActivityRow({ steps }: { steps: ToolStep[] }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  // Internal steps stay hidden unless something went wrong with them (a gate block is worth seeing).
  const shown = steps.filter((s) => !toolMeta(s.name).hidden || s.status === 'blocked' || s.status === 'error');
  const running = steps.filter((s) => s.status === 'start');
  const current = running[running.length - 1];
  const blocked = shown.filter((s) => s.status === 'blocked');
  const failed = shown.filter((s) => s.status === 'error');
  if (!current && !shown.length) return null;

  if (current) {
    return (
      <View style={styles.header}>
        <ActivityIndicator size="small" color={c.text2} />
        <Pulse>
          <T v="subhead" color="text2" numberOfLines={1}>
            {toolMeta(current.name).doing(current.args ?? {})}…
          </T>
        </Pulse>
      </View>
    );
  }

  const done = shown.filter((s) => s.status === 'ok').length;
  const checked = `Checked ${done} source${done === 1 ? '' : 's'}`;
  // A data source that failed is "unavailable"; a malformed present_plan/refuse is just returned to the model to fix.
  const down = failed.filter((s) => !toolMeta(s.name).hidden);
  const unavailable = down.length === 1 ? `${toolMeta(down[0].name).label} unavailable` : `${down.length} sources unavailable`;
  const [icon, tone, label] = blocked.length
    ? (['hand.raised', 'caution', 'Safety gate sent the plan back'] as const)
    : down.length
      ? (['exclamationmark.triangle', 'caution', done ? `${checked} · ${down.length} unavailable` : unavailable] as const)
      : failed.length && !done
        ? (['arrow.uturn.backward', 'text2', 'Plan sent back for a fix'] as const)
        : (['checkmark.circle', 'text2', checked] as const);

  return (
    <View>
      <Press onPress={() => setOpen((o) => !o)} style={styles.header} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Icon name={icon} size={16} color={tone} />
        <T v="subhead" color={tone}>
          {label}
        </T>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} size={11} weight="semibold" color="text3" />
      </Press>
      {open && (
        <Animated.View entering={FadeIn.duration(160)} style={[styles.list, { borderLeftColor: c.separator }]}>
          {shown.map((s) => {
            const meta = toolMeta(s.name);
            const status =
              s.status === 'ok'
                ? (['checkmark', 'accent'] as const)
                : s.status === 'blocked'
                  ? (['hand.raised.fill', 'caution'] as const)
                  : s.status === 'error'
                    ? (['exclamationmark.triangle.fill', 'caution'] as const)
                    : (['ellipsis', 'text3'] as const);
            return (
              <View key={s.call_id} style={styles.step}>
                <Icon name={meta.icon} size={15} color="text2" />
                <View style={styles.flex}>
                  <T v="subhead">{meta.label}</T>
                  {s.summary ? (
                    <T v="footnote" color="text2" numberOfLines={2}>
                      {s.summary}
                    </T>
                  ) : null}
                </View>
                <Icon name={status[0]} size={13} weight="semibold" color={status[1]} />
              </View>
            );
          })}
        </Animated.View>
      )}
    </View>
  );
}

/** "Thinking" before the first tool or token arrives. */
export function Thinking() {
  const { c } = useTheme();
  return (
    <View style={styles.header}>
      <ActivityIndicator size="small" color={c.text2} />
      <Pulse>
        <T v="subhead" color="text2">
          Thinking…
        </T>
      </Pulse>
    </View>
  );
}

function Pulse({ children }: { children: React.ReactNode }) {
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(withTiming(0.4, { duration: 750 }), -1, true);
  }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.shrink, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, alignSelf: 'flex-start' },
  list: { marginLeft: 7, paddingLeft: 14, borderLeftWidth: 1.5, gap: 12, paddingVertical: 6 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
});
