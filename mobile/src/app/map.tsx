import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrailMap, type MapLayer, type MapTrack } from '@/components/trail/trail-map';
import { Button, Glass, Press, T, Icon } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { useAgent } from '@/lib/agent';
import { fmtHours, fmtKm, fmtM, trailTitle } from '@/lib/format';
import { useRecent } from '@/lib/recent';
import { useTrailDetail } from '@/lib/trails';

/** Map mode: opened from a plan (primary + backup) or a trail, never the app's background. */
export default function MapScreen() {
  const { plan: planId, trail: trailId } = useLocalSearchParams<{ plan?: string; trail?: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { get } = useRecent();
  const { items } = useAgent();
  const [layer, setLayer] = useState<MapLayer>('map');

  const outcome = planId ? get(planId) : undefined;
  const fromChat = planId ? items.find((i) => i.id === planId) : undefined;
  const plan = outcome?.kind === 'plan' ? outcome.plan : fromChat?.kind === 'plan' ? fromChat.plan : undefined;
  const primaryId = plan?.primary.id ?? trailId;
  const { trail: primary } = useTrailDetail(primaryId);
  const { trail: backup } = useTrailDetail(plan?.backup?.id);

  const tracks: MapTrack[] = [
    ...(primary ? [{ id: primary.id, name: primary.name, role: 'primary' as const, segments: primary.segments }] : []),
    ...(backup ? [{ id: backup.id, name: backup.name, role: 'backup' as const, segments: backup.segments }] : []),
  ];
  const start = primary?.segments[0]?.[0];
  const directions = () => start && Linking.openURL(`https://maps.apple.com/?daddr=${start.join(',')}&dirflg=r`);

  return (
    <View style={[styles.flex, { backgroundColor: c.bg }]}>
      <TrailMap tracks={tracks} layer={layer} padding={{ top: insets.top + 80, right: 50, bottom: 260, left: 50 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.tools, { top: insets.top + 56 }]}>
        <Glass style={styles.toolButton} interactive>
          <Press onPress={() => setLayer((l) => (l === 'map' ? 'satellite' : 'map'))} style={styles.toolPress} accessibilityLabel={layer === 'map' ? 'Show satellite' : 'Show map'}>
            <Icon name={layer === 'map' ? 'globe.asia.australia' : 'map'} size={19} color="text" />
          </Press>
        </Glass>
      </View>
      {primary ? (
        <View style={[styles.cardWrap, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Glass style={styles.card}>
            <T v="headline">{trailTitle(primary)}</T>
            <T v="subhead" color="text2" style={styles.tabular}>
              {fmtKm(primary.length_km)} km · {fmtHours(plan?.primary.hours ?? primary.official_hours)}
              {primary.profile ? ` · ${fmtM(primary.profile.ascent_m)} m climb` : ''}
            </T>
            {backup ? (
              <View style={styles.legend}>
                <Swatch color={c.accent} label="Plan" />
                <Swatch color={c.info} label={`Backup · ${trailTitle(backup)}`} />
              </View>
            ) : null}
            <Button title="Directions to the start" icon="tram.fill" onPress={directions} style={styles.button} />
          </Glass>
        </View>
      ) : null}
    </View>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.swatch}>
      <View style={[styles.swatchLine, { backgroundColor: color }]} />
      <T v="caption" color="text2" numberOfLines={1} style={styles.shrink}>
        {label}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  tools: { position: 'absolute', right: 16 },
  toolButton: { borderRadius: 22 },
  toolPress: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cardWrap: { position: 'absolute', left: 16, right: 16, bottom: 0 },
  card: { padding: 16, gap: 6, borderRadius: 28 },
  legend: { gap: 4, marginTop: 4 },
  swatch: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatchLine: { width: 18, height: 4, borderRadius: 2 },
  button: { marginTop: 10 },
});
