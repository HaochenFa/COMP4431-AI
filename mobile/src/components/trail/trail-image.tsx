import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useTrails } from '@/lib/trails';
import type { LatLng } from '@/lib/types';

import { TrailRouteArt } from './route-art';

/**
 * The trail's official AFCD photo, or its route art when there is none (or it fails to load).
 * `scrim` darkens the bottom so white text on top stays readable; children render above it.
 */
export function TrailImage({
  id,
  size = 'thumb',
  segments,
  scrim,
  style,
  children,
}: {
  id: string;
  size?: 'thumb' | 'hero';
  segments?: LatLng[][];
  scrim?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const { photo } = useTrails();
  const [broken, setBroken] = useState(false);
  const uri = broken ? null : photo(id, size);
  return (
    <View style={[styles.box, style]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} onError={() => setBroken(true)} accessibilityIgnoresInvertColors />
      ) : (
        <TrailRouteArt id={id} segments={segments} style={StyleSheet.absoluteFill} strokeWidth={size === 'hero' ? 4 : 3} />
      )}
      {scrim && uri ? <Scrim /> : null}
      {children}
    </View>
  );
}

export function Scrim({ from = 0.35 }: { from?: number }) {
  return (
    <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 1 1">
      <Defs>
        <LinearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor="#000" stopOpacity={0.25} />
          <Stop offset={from} stopColor="#000" stopOpacity={0} />
          <Stop offset={1} stopColor="#000" stopOpacity={0.72} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={1} height={1} fill="url(#scrim)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
});
