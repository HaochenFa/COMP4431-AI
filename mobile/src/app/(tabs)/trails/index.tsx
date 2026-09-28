import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrailFeature, TrailRow } from '@/components/trail/trail-row';
import { TrailMap } from '@/components/trail/trail-map';
import { Button, Chip, Glass, Icon, SearchField, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { useTrails } from '@/lib/trails';
import type { TrailSummary } from '@/lib/types';

const DIFFICULTIES = ['Easy', 'Moderate', 'Demanding', 'Difficult'];
const REGIONS: [string, string][] = [
  ['Hong Kong Island', 'HK Island'],
  ['Lantau Island', 'Lantau'],
  ['Sai Kung', 'Sai Kung'],
  ['North New Territories', 'North NT'],
  ['Central New Territories', 'Central NT'],
  ['West New Territories', 'West NT'],
];

/** Browse the official AFCD trails: a list first, the map one tap away (the AllTrails pattern). */
export default function Trails() {
  const { c } = useTheme();
  const { list, error, reload } = useTrails();
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'map'>('list');
  const [selected, setSelected] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const q = query.trim().toLowerCase();
  const shown = (list ?? []).filter(
    (t) =>
      (!difficulty || t.difficulty === difficulty || (difficulty === 'Difficult' && t.difficulty === 'Very difficult')) &&
      (!region || t.region === region) &&
      (!q || [t.name, t.trail, t.start, t.finish, t.region, ...t.landmarks].some((s) => s?.toLowerCase().includes(q))),
  );
  // Found by a landmark, not its name ("Dragon" → Hong Kong Trail · Section 8): say which one.
  const note = (t: TrailSummary) => (q ? t.landmarks.find((l) => l.toLowerCase().includes(q)) : undefined);
  const open = (t: TrailSummary) => router.push(`/trail/${t.id}`);
  const picked = shown.find((t) => t.id === selected);

  const onMap = mode === 'map';
  const search = <SearchField value={query} onChangeText={setQuery} placeholder="Search by name or place" />;
  const filters = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips} style={styles.bleed}>
      {DIFFICULTIES.map((d) => (
        <Chip
          key={d}
          label={d}
          tone={onMap ? 'glass' : 'neutral'}
          selected={difficulty === d}
          onPress={() => setDifficulty(difficulty === d ? null : d)}
          style={styles.chip}
        />
      ))}
      <View style={[styles.divider, { backgroundColor: c.separator }]} />
      {REGIONS.map(([value, label]) => (
        <Chip
          key={value}
          label={label}
          tone={onMap ? 'glass' : 'neutral'}
          selected={region === value}
          onPress={() => setRegion(region === value ? null : value)}
          style={styles.chip}
        />
      ))}
    </ScrollView>
  );
  const header = (
    <View style={styles.filters}>
      {search}
      {filters}
      <T v="footnote" color="text2">
        {list ? `${shown.length} official ${shown.length === 1 ? 'trail' : 'trails'}` : ' '}
      </T>
    </View>
  );

  return (
    <>
      {/* Search is our own glass field, not the header's: the native one only turns to glass once focused. */}
      <Stack.Screen options={{ headerLargeTitle: !onMap }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={mode === 'list' ? 'map' : 'list.bullet'}
          onPress={() => setMode(mode === 'list' ? 'map' : 'list')}
          accessibilityLabel={mode === 'list' ? 'Show on map' : 'Show as list'}
        />
      </Stack.Toolbar>
      {mode === 'list' ? (
        <FlatList
          style={{ backgroundColor: c.bg }}
          contentInsetAdjustmentBehavior="automatic"
          data={shown}
          keyExtractor={(t) => t.id}
          ListHeaderComponent={header}
          renderItem={({ item, index }) =>
            index === 0 ? (
              <TrailFeature t={item} note={note(item)} onPress={() => open(item)} />
            ) : (
              <TrailRow t={item} note={note(item)} onPress={() => open(item)} />
            )
          }
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          contentContainerStyle={styles.list}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            !list ? (
              error ? (
                <View style={styles.empty}>
                  <Icon name="wifi.exclamationmark" size={30} color="text3" />
                  <T v="headline">Can&apos;t load the trails</T>
                  <T v="subhead" color="text2" center>
                    Check the server address in Settings.
                  </T>
                  <Button title="Try again" variant="secondary" onPress={reload} />
                </View>
              ) : (
                <ActivityIndicator style={styles.loading} color={c.text2} />
              )
            ) : (
              <View style={styles.empty}>
                <Icon name="magnifyingglass" size={30} color="text3" />
                <T v="headline">No trails match</T>
                <T v="subhead" color="text2" center>
                  Try another name, or clear a filter.
                </T>
              </View>
            )
          }
        />
      ) : (
        <View style={styles.flex}>
          <TrailMap
            style={StyleSheet.absoluteFill}
            pins={shown.filter((t) => t.start_coord).map((t) => ({ id: t.id, coord: t.start_coord!, title: t.name, selected: t.id === selected }))}
            onPinPress={setSelected}
            padding={{ top: 220, right: 40, bottom: 200, left: 40 }}
          />
          <View style={[styles.mapTop, { top: insets.top + 56 }]} pointerEvents="box-none">
            {search}
            {filters}
          </View>
          {picked ? (
            <SafeAreaView edges={['bottom']} style={styles.pickedWrap} pointerEvents="box-none">
              <Glass style={styles.picked}>
                <TrailRow t={picked} onPress={() => open(picked)} />
              </Glass>
            </SafeAreaView>
          ) : null}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  filters: { gap: 12, paddingBottom: 14, paddingTop: 4 },
  mapTop: { position: 'absolute', left: 16, right: 16, gap: 10 },
  bleed: { marginHorizontal: -16 },
  chips: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 13, paddingVertical: 8 },
  divider: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 4 },
  gap: { height: 10 },
  empty: { alignItems: 'center', gap: 10, paddingTop: 60, paddingHorizontal: 24 },
  loading: { paddingTop: 60 },
  pickedWrap: { position: 'absolute', left: 16, right: 16, bottom: 12 },
  picked: { borderRadius: 24, paddingHorizontal: 12, paddingVertical: 4 },
});
