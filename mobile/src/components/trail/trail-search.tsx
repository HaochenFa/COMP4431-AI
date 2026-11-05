import { FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon, ListRow, ListSection, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import type { TrailSummary } from '@/lib/types';

import { TrailRow } from './trail-row';

// Well-known places to try before typing; each one is in the trail data's landmark names.
const SUGGESTIONS = ["Dragon's Back", 'Lion Rock', 'Lantau Peak', 'Sharp Peak', 'Tai Mo Shan', 'Tai O'];

export const matchesQuery = (t: TrailSummary, q: string) =>
  [t.name, t.trail, t.start, t.finish, t.region, ...t.landmarks, ...t.search_zh].some((s) => s?.toLowerCase().includes(q));

/** Found by a landmark, not its name ("Dragon" → Hong Kong Trail · Section 8): say which one. */
export const landmarkNote = (t: TrailSummary, q: string) => (q ? t.landmarks.find((l) => l.toLowerCase().includes(q)) : undefined);

/**
 * The results of the header's native search, over the trail list like a search controller's results view: the list
 * underneath keeps its place, results start at the top of their own list, and closing the search brings the list
 * back as it was. The search field, its Liquid Glass morph and its close button are the system's (Stack.SearchBar).
 */
export function TrailResults({
  trails,
  query,
  top,
  within,
  onPickPlace,
  onOpenTrail,
}: {
  trails: TrailSummary[];
  query: string;
  top: number;
  within?: string;
  onPickPlace: (name: string) => void;
  onOpenTrail: (t: TrailSummary) => void;
}) {
  const { c } = useTheme();
  const q = query.trim().toLowerCase();
  const results = q ? trails.filter((t) => matchesQuery(t, q)) : [];
  const places = SUGGESTIONS.map((name) => ({ name, count: trails.filter((t) => t.landmarks.includes(name)).length })).filter((p) => p.count > 0);

  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} style={[styles.layer, { backgroundColor: c.bg, paddingTop: top }]}>
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
              onPress={() => onPickPlace(pl.name)}
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
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  within: { paddingHorizontal: 16, paddingTop: 8 },
  places: { marginHorizontal: 16, marginTop: 8 },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 140 },
  count: { paddingBottom: 10 },
  gap: { height: 10 },
  empty: { alignItems: 'center', gap: 10, paddingTop: 60, paddingHorizontal: 24 },
});
