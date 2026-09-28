import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import type { ElevationProfile } from '@/lib/types';

const PAD_TOP = 10;
const PAD_BOTTOM = 4;

/** Official GPX heights, start (left) to finish (right). Drag across it to read distance and height. */
export function ElevationChart({ profile, height = 132 }: { profile: ElevationProfile; height?: number }) {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  const [at, setAt] = useState<number | null>(null);
  const { d_km: d, ele_m: e } = profile;
  const total = d[d.length - 1] || 1;
  const lo = Math.min(...e);
  const span = Math.max(Math.max(...e) - lo, 50); // keep gentle walks from looking like cliffs
  const x = (km: number) => (km / total) * width;
  const y = (m: number) => PAD_TOP + (1 - (m - lo) / span) * (height - PAD_TOP - PAD_BOTTOM);
  const line = d.map((km, i) => `${i ? 'L' : 'M'}${x(km).toFixed(1)},${y(e[i]).toFixed(1)}`).join('');
  const peak = e.indexOf(Math.max(...e));

  const nearest = (px: number) => {
    const km = Math.min(Math.max(px / Math.max(width, 1), 0), 1) * total;
    let best = 0;
    for (let i = 1; i < d.length; i++) if (Math.abs(d[i] - km) < Math.abs(d[best] - km)) best = i;
    return best;
  };
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onBegin((ev) => {
      setAt(nearest(ev.x));
      Haptics.selectionAsync().catch(() => {});
    })
    .onUpdate((ev) => setAt(nearest(ev.x)))
    .onFinalize(() => setAt(null));

  const i = at ?? peak;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <T v="footnote" color="text2">
          {at == null ? 'Elevation' : `${d[i].toFixed(1)} km`}
        </T>
        <T v="footnote" color={at == null ? 'text3' : 'accent'} weight={at == null ? '400' : '600'} style={styles.tabular}>
          {at == null ? 'Drag to explore' : `${Math.round(e[i])} m`}
        </T>
      </View>
      <GestureDetector gesture={pan}>
        <View
          onLayout={(ev) => setWidth(ev.nativeEvent.layout.width)}
          style={{ height }}
          accessible
          accessibilityLabel={`Elevation profile: ${profile.ascent_m} metres of climb, highest point ${profile.max_m} metres`}>
          {width > 0 && (
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id="elev" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={c.accent} stopOpacity={0.32} />
                  <Stop offset="1" stopColor={c.accent} stopOpacity={0.02} />
                </LinearGradient>
              </Defs>
              <Line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke={c.separator} strokeWidth={1} />
              <Path d={`${line}L${width},${height}L0,${height}Z`} fill="url(#elev)" />
              <Path d={line} stroke={c.accent} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              {at != null && <Line x1={x(d[i])} x2={x(d[i])} y1={0} y2={height} stroke={c.text2} strokeWidth={1} strokeDasharray="3 3" />}
              <Circle cx={x(d[i])} cy={y(e[i])} r={4.5} fill={at == null ? c.text : c.accent} stroke={c.bg} strokeWidth={2} />
            </Svg>
          )}
        </View>
      </GestureDetector>
      <View style={styles.row}>
        <T v="caption" color="text3" style={styles.tabular}>
          Start {Math.round(e[0])} m
        </T>
        <T v="caption" color="text3" style={styles.tabular}>
          Finish {Math.round(e[e.length - 1])} m
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  tabular: { fontVariant: ['tabular-nums'] },
});
