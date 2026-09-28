import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { T } from '@/components/ui';
import { useTrails } from '@/lib/trails';
import type { LatLng } from '@/lib/types';

import { TrailImage } from './trail-image';

/**
 * Full-bleed header for a plan or trail page: the AFCD photo (route art without one) with the title over a
 * scrim. Pass the page's scroll offset for a gentle parallax and pull-to-stretch.
 */
export function TrailHero({
  id,
  segments,
  title,
  subtitle,
  badge,
  scrollY,
  height = 380,
}: {
  id: string;
  segments?: LatLng[][];
  title: string;
  subtitle?: string | null;
  badge?: ReactNode;
  scrollY?: SharedValue<number>;
  height?: number;
}) {
  const { photo } = useTrails();
  const onPhoto = Boolean(photo(id, 'hero'));
  const parallax = useAnimatedStyle(() => {
    const y = scrollY?.value ?? 0;
    return { transform: [{ translateY: y < 0 ? y / 2 : y * 0.35 }, { scale: y < 0 ? 1 - y / height : 1 }] };
  });
  return (
    <View style={{ height }}>
      <Animated.View style={[StyleSheet.absoluteFill, parallax]}>
        <TrailImage id={id} size="hero" scrim segments={segments} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <View style={styles.overlay}>
        {badge}
        <T v="title" color={onPhoto ? '#FFFFFF' : 'text'} style={styles.title}>
          {title}
        </T>
        {subtitle ? (
          <T v="subhead" color={onPhoto ? 'rgba(255,255,255,0.86)' : 'text2'}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {onPhoto ? (
        <T v="caption" color="rgba(255,255,255,0.6)" style={styles.credit}>
          Photo: AFCD
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 16, right: 16, bottom: 26, gap: 6 },
  title: { marginTop: 4 },
  credit: { position: 'absolute', right: 12, bottom: 6 },
});
