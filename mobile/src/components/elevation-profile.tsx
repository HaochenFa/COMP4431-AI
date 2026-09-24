import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { C } from '@/constants/palette';
import type { ElevationProfile } from '@/lib/types';

const HEIGHT = 84;
const PAD = 4;

// Area chart of the official GPX heights, start (left) to finish (right).
export function ElevationChart({ profile }: { profile: ElevationProfile }) {
  const [width, setWidth] = useState(0);
  const { d_km: d, ele_m: e } = profile;
  const total = d[d.length - 1] || 1;
  const lo = Math.min(...e);
  const span = Math.max(Math.max(...e) - lo, 50); // keep gentle walks from looking like cliffs
  const x = (km: number) => (km / total) * width;
  const y = (m: number) => PAD + (1 - (m - lo) / span) * (HEIGHT - 2 * PAD);
  const line = d.map((km, i) => `${i ? 'L' : 'M'}${x(km).toFixed(1)},${y(e[i]).toFixed(1)}`).join(' ');
  const peak = e.indexOf(Math.max(...e));

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.stat}>↗ {profile.ascent_m} m climb</Text>
        <Text style={styles.stat}>▲ {profile.max_m} m high point</Text>
      </View>
      <View onLayout={(ev) => setWidth(ev.nativeEvent.layout.width)} style={{ height: HEIGHT }}>
        {width > 0 && (
          <Svg width={width} height={HEIGHT} accessibilityLabel={`Elevation profile: ${profile.ascent_m} metres of climb`}>
            <Defs>
              <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={C.moss} stopOpacity={0.45} />
                <Stop offset="1" stopColor={C.moss} stopOpacity={0.05} />
              </LinearGradient>
            </Defs>
            <Path d={`${line} L${width},${HEIGHT} L0,${HEIGHT} Z`} fill="url(#fill)" />
            <Path d={line} stroke={C.ink} strokeWidth={1.5} fill="none" strokeLinejoin="round" />
            <Circle cx={x(d[peak])} cy={y(e[peak])} r={3.5} fill={C.post} stroke={C.ink} strokeWidth={1} />
          </Svg>
        )}
      </View>
      <View style={styles.row}>
        <Text style={styles.axis}>Start · {e[0]} m</Text>
        <Text style={styles.axis}>
          {total.toFixed(1)} km · Finish {e[e.length - 1]} m
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4, marginVertical: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { fontSize: 13, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  axis: { fontSize: 11, color: C.muted, fontVariant: ['tabular-nums'] },
});
