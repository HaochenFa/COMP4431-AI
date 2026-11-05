import { Stack, router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SearchBarCommands } from 'react-native-screens';

import { TrailFeature, TrailRow } from '@/components/trail/trail-row';
import { TrailMap } from '@/components/trail/trail-map';
import { TrailResults, landmarkNote, matchesQuery } from '@/components/trail/trail-search';
import { Button, Chip, Glass, Icon, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { useTrails } from '@/lib/trails';
import type { TrailSummary } from '@/lib/types';

const DIFFICULTIES = ['Easy', 'Moderate', 'Demanding', 'Difficult', 'Unrated'];
const REGIONS: [string, string][] = [
  ['Hong Kong Island', 'HK Island'],
  ['Lantau Island', 'Lantau'],
  ['Sai Kung', 'Sai Kung'],
  ['North New Territories', 'North NT'],
  ['Central New Territories', 'Central NT'],
  ['West New Territories', 'West NT'],
  ['Peng Chau', 'Peng Chau'],
];

// The compact navigation bar's height under the status bar (iOS 26): the search results start below it.
const NAV_BAR = 54;

const matchesDifficulty = (t: TrailSummary, wanted: string) =>
  t.difficulty === wanted || (wanted === 'Difficult' && t.difficulty === 'Very difficult') || (wanted === 'Unrated' && t.difficulty === 'NA');

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

  // Search is the system's: a Liquid Glass button in the header that morphs into a field (Stack.SearchBar). On the
  // list, its results show over the list (TrailResults), which is never filtered by the query and so keeps its
  // place; on the map, the query filters the pins as you type.
  const searchBar = useRef<SearchBarCommands>(null);
  const [searching, setSearching] = useState(false);
  const pickPlace = (name: string) => {
    searchBar.current?.setText(name);
    setQuery(name);
  };

  const onMap = mode === 'map';
  const filtered = (list ?? []).filter((t) => (!difficulty || matchesDifficulty(t, difficulty)) && (!region || t.region === region));
  const q = query.trim().toLowerCase();
  const pins = onMap && q ? filtered.filter((t) => matchesQuery(t, q)) : filtered;
  const open = (t: TrailSummary) => router.push(`/trail/${t.id}`);
  const picked = pins.find((t) => t.id === selected);
  const within = [difficulty, REGIONS.find(([v]) => v === region)?.[1]].filter(Boolean).join(' · ');

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
      {filters}
      <T v="footnote" color="text2">
        {list ? `${filtered.length} official ${filtered.length === 1 ? 'trail' : 'trails'}` : ' '}
      </T>
    </View>
  );

  return (
    <>
      {/* react-native-screens applies scrollEdgeEffects to the screen's first scroll view only when the option
          changes, not when the list or the map's ScrollView mounts later, so the value differs per mode (`left`
          is inert here) to re-apply the soft top edge after each switch. */}
      <Stack.Screen options={{ headerLargeTitle: !onMap, scrollEdgeEffects: { top: 'soft', left: onMap ? 'hidden' : 'automatic' } }} />
      <Stack.SearchBar
        ref={searchBar}
        placement="integratedButton"
        allowToolbarIntegration={false}
        placeholder="Search by name or place"
        autoCapitalize="none"
        hideWhenScrolling={false}
        obscureBackground={false}
        onFocus={() => setSearching(true)}
        onChangeText={(e) => setQuery(e.nativeEvent.text)}
        // Fired by the glass X too, via patches/react-native-screens (iOS 26 sends nothing otherwise).
        onCancelButtonPress={() => {
          setSearching(false);
          setQuery('');
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon={onMap ? 'list.bullet' : 'map'} onPress={() => setMode(onMap ? 'list' : 'map')} accessibilityLabel={onMap ? 'Show as list' : 'Show on map'} />
      </Stack.Toolbar>
      {!onMap ? (
        <View style={styles.flex}>
          <FlatList
            style={{ backgroundColor: c.bg }}
            contentInsetAdjustmentBehavior="automatic"
            data={filtered}
            keyExtractor={(t) => t.id}
            ListHeaderComponent={header}
            renderItem={({ item, index }) => (index === 0 ? <TrailFeature t={item} onPress={() => open(item)} /> : <TrailRow t={item} onPress={() => open(item)} />)}
            ItemSeparatorComponent={() => <View style={styles.gap} />}
            contentContainerStyle={styles.list}
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
                  <Icon name="line.3.horizontal.decrease" size={30} color="text3" />
                  <T v="headline">No trails match</T>
                  <T v="subhead" color="text2" center>
                    Clear a filter to see more.
                  </T>
                </View>
              )
            }
          />
          {searching ? (
            <TrailResults
              trails={filtered}
              query={query}
              top={insets.top + NAV_BAR}
              within={within || undefined}
              onPickPlace={pickPlace}
              onOpenTrail={open}
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.flex}>
          {/* A still ScrollView around the map, first in the tree: the header's soft edge (scrollEdgeEffects) is only
              applied to the screen's first scroll view, and without it UIKit falls back to the chips' row, drawing
              a hard edge with a dividing line over the map. */}
          <ScrollView
            style={StyleSheet.absoluteFill}
            contentContainerStyle={styles.flex}
            scrollEnabled={false}
            contentInsetAdjustmentBehavior="never"
          >
            <TrailMap
              style={StyleSheet.absoluteFill}
              pins={pins.filter((t) => t.start_coord).map((t) => ({ id: t.id, coord: t.start_coord!, title: t.name, selected: t.id === selected }))}
              onPinPress={setSelected}
              padding={{ top: 150, right: 24, bottom: 170, left: 24 }}
            />
          </ScrollView>
          <View style={[styles.mapTop, { top: insets.top + NAV_BAR + 6 }]} pointerEvents="box-none">
            {filters}
          </View>
          {picked ? (
            <SafeAreaView edges={['bottom']} style={styles.pickedWrap} pointerEvents="box-none">
              <Glass style={styles.picked}>
                <TrailRow t={picked} note={landmarkNote(picked, q)} onPress={() => open(picked)} />
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
  mapTop: { position: 'absolute', left: 16, right: 16 },
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
