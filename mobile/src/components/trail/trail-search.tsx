import { useEffect } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { GlassButton, Icon, ListRow, ListSection, SearchField, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import type { TrailSummary } from '@/lib/types';

import { TrailRow } from './trail-row';

// Well-known places to try before typing; each one is in the trail data's landmark names.
const SUGGESTIONS = ["Dragon's Back", 'Lion Rock', 'Lantau Peak', 'Sharp Peak', 'Tai Mo Shan', 'Tai O'];
const FIELD_HEIGHT = 46;
const CLOSE_GAP = 10;

export type Rect = { x: number; y: number; width: number; height: number };

export const matchesQuery = (t: TrailSummary, q: string) =>
  [t.name, t.trail, t.start, t.finish, t.region, ...t.landmarks, ...t.search_zh].some((s) => s?.toLowerCase().includes(q));

/** Found by a landmark, not its name ("Dragon" → Hong Kong Trail · Section 8): say which one. */
export const landmarkNote = (t: TrailSummary, q: string) => (q ? t.landmarks.find((l) => l.toLowerCase().includes(q)) : undefined);

/**
 * Search as a mode over the trail list, like a search controller with its own results: the list underneath keeps its
 * place, the results start at the top of their own list, and closing brings the list back exactly as it was.
 *
 * The field grows out of what opened it (`from`, in window points: the list's own field, or the header's search
 * button) into place under the header, and shrinks back into it on close; `onClosed` fires once it has. One progress
 * value drives it all as animated styles: Liquid Glass doesn't render inside a Reanimated `entering` animation or under
 * a fading parent, so only the backdrop and the plain content fade, and glass only moves, resizes or scales.
 */
export function TrailSearch({
  trails,
  query,
  onChangeQuery,
  open,
  from,
  top,
  within,
  onOpenTrail,
  onClose,
  onClosed,
}: {
  trails: TrailSummary[];
  query: string;
  onChangeQuery: (q: string) => void;
  open: boolean;
  from: Rect;
  top: number;
  within?: string;
  onOpenTrail: (t: TrailSummary) => void;
  onClose: () => void;
  onClosed: () => void;
}) {
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const q = query.trim().toLowerCase();
  const results = q ? trails.filter((t) => matchesQuery(t, q)) : [];
  const places = SUGGESTIONS.map((name) => ({ name, count: trails.filter((t) => t.landmarks.includes(name)).length })).filter((p) => p.count > 0);

  const to: Rect = { x: 16, y: top + 8, width: width - 32 - FIELD_HEIGHT - CLOSE_GAP, height: FIELD_HEIGHT };
  const p = useSharedValue(0);
  useEffect(() => {
    // Opening waits a beat: the header's large title collapses in the same frames, and the grow would lose them.
    p.set(
      withDelay(
        open ? 60 : 0,
        withTiming(open ? 1 : 0, { duration: open ? 420 : 320, easing: Easing.out(Easing.cubic) }, (done) => {
          if (done && !open) scheduleOnRN(onClosed);
        }),
      ),
    );
  }, [open, p, onClosed]);

  const fieldStyle = useAnimatedStyle(() => ({
    left: from.x + (to.x - from.x) * p.get(),
    top: from.y + (to.y - from.y) * p.get(),
    width: from.width + (to.width - from.width) * p.get(),
  }));
  const closeStyle = useAnimatedStyle(() => ({ transform: [{ scale: p.get() }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: p.get() }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ translateY: (1 - p.get()) * 16 }] }));

  return (
    <View style={styles.layer} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[styles.layer, { backgroundColor: c.bg }, backdropStyle]} />
      <Animated.View style={[styles.content, { paddingTop: to.y + FIELD_HEIGHT + 6 }, contentStyle]}>
        {within ? (
          <T v="footnote" color="text2" style={styles.within}>
            Within {within}
          </T>
        ) : null}
        {!q ? (
          <ListSection title="Popular places" inset={52} style={styles.places}>
            {places.map((pl) => (
              <ListRow
                key={pl.name}
                icon="mountain.2"
                iconColor="accentInk"
                title={pl.name}
                subtitle={`${pl.count} ${pl.count === 1 ? 'trail' : 'trails'}`}
                accessory="chevron"
                onPress={() => onChangeQuery(pl.name)}
              />
            ))}
          </ListSection>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(t) => t.id}
            renderItem={({ item }) => <TrailRow t={item} note={landmarkNote(item, q)} onPress={() => onOpenTrail(item)} />}
            ItemSeparatorComponent={() => <View style={styles.gap} />}
            ListHeaderComponent={
              results.length ? (
                <T v="footnote" color="text2" style={styles.count}>
                  {results.length} {results.length === 1 ? 'trail' : 'trails'}
                </T>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Icon name="magnifyingglass" size={30} color="text3" />
                <T v="headline">No trails match</T>
                <T v="subhead" color="text2" center>
                  {within ? 'Try another name, or clear a filter.' : 'Try another name or place.'}
                </T>
              </View>
            }
            contentContainerStyle={styles.list}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          />
        )}
      </Animated.View>
      <Animated.View style={[styles.field, fieldStyle]}>
        <SearchField value={query} onChangeText={onChangeQuery} placeholder="Search by name or place" autoFocus />
      </Animated.View>
      <Animated.View style={[styles.close, { top: to.y, left: width - 16 - FIELD_HEIGHT }, closeStyle]}>
        <GlassButton icon="xmark" size={FIELD_HEIGHT} onPress={onClose} accessibilityLabel="Close search" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  content: { flex: 1 },
  field: { position: 'absolute', height: FIELD_HEIGHT },
  close: { position: 'absolute' },
  within: { paddingHorizontal: 16, paddingTop: 8 },
  places: { marginHorizontal: 16, marginTop: 14 },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 140 },
  count: { paddingBottom: 10 },
  gap: { height: 10 },
  empty: { alignItems: 'center', gap: 10, paddingTop: 60, paddingHorizontal: 24 },
});
