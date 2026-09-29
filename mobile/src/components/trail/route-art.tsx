import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

import { useTheme } from '@/constants/theme';
import { useTrailDetail } from '@/lib/trails';
import type { LatLng } from '@/lib/types';

/**
 * The trail's own shape from its official track, drawn like a topo sketch: faint contour rings behind a
 * lime line, start dot and finish dot. Stands in for a photo where AFCD has none.
 */
export function RouteArt({
  segments,
  style,
  strokeWidth = 3,
  padding = 0.16,
}: {
  segments: LatLng[][] | undefined;
  style?: StyleProp<ViewStyle>;
  strokeWidth?: number;
  padding?: number;
}) {
  const { c } = useTheme();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pts = (segments ?? []).filter((s) => s.length > 1);
  const all = pts.flat();

  let paths: string[] = [];
  let start: [number, number] | null = null;
  let end: [number, number] | null = null;
  if (all.length > 1 && size.w > 0) {
    const lats = all.map((p) => p[0]);
    const lngs = all.map((p) => p[1]);
    const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180); // metres per degree of longitude shrink with latitude
    const spanX = Math.max((maxLng - minLng) * kx, 1e-6);
    const spanY = Math.max(maxLat - minLat, 1e-6);
    const pad = Math.min(size.w, size.h) * padding;
    const scale = Math.min((size.w - 2 * pad) / spanX, (size.h - 2 * pad) / spanY);
    const ox = (size.w - spanX * scale) / 2;
    const oy = (size.h - spanY * scale) / 2;
    const xy = ([lat, lng]: LatLng): [number, number] => [ox + (lng - minLng) * kx * scale, oy + (maxLat - lat) * scale];
    paths = pts.map((seg) => seg.map((p, i) => `${i ? 'L' : 'M'}${xy(p).map((n) => n.toFixed(1)).join(',')}`).join(''));
    start = xy(pts[0][0]);
    const lastSeg = pts[pts.length - 1];
    end = xy(lastSeg[lastSeg.length - 1]);
  }

  const cx = size.w / 2;
  const cy = size.h / 2;
  return (
    <View style={[styles.box, { backgroundColor: c.surface2 }, style]} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {size.w > 0 && (
        <Svg width={size.w} height={size.h}>
          {[0.35, 0.6, 0.85, 1.1, 1.4].map((k) => (
            <Ellipse key={k} cx={cx * 0.9} cy={cy * 1.1} rx={size.w * k * 0.55} ry={size.h * k * 0.5} stroke={c.separator} strokeWidth={1} fill="none" />
          ))}
          {paths.map((d, i) => (
            <Path key={`c${i}`} d={d} stroke={c.routeCase} strokeOpacity={0.9} strokeWidth={strokeWidth + 3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {paths.map((d, i) => (
            <Path key={`l${i}`} d={d} stroke={c.accent} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {end && <Circle cx={end[0]} cy={end[1]} r={strokeWidth + 1.5} fill={c.text} stroke={c.routeCase} strokeWidth={2} />}
          {start && <Circle cx={start[0]} cy={start[1]} r={strokeWidth + 1.5} fill={c.accent} stroke={c.routeCase} strokeWidth={2} />}
        </Svg>
      )}
    </View>
  );
}

/** RouteArt for a trail id, fetching its track if needed. */
export function TrailRouteArt({ id, segments, ...rest }: { id: string; segments?: LatLng[][] } & Omit<Parameters<typeof RouteArt>[0], 'segments'>) {
  const { trail } = useTrailDetail(segments ? undefined : id);
  return <RouteArt segments={segments ?? trail?.segments} {...rest} />;
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
});
