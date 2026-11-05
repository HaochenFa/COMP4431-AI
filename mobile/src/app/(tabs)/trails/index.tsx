import { Stack, router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { TrailFeature, TrailRow } from '@/components/trail/trail-row';
import { TrailMap } from '@/components/trail/trail-map';
import { TrailSearch, landmarkNote, matchesQuery, type Rect } from '@/components/trail/trail-search';
import { Button, Chip, Glass, Icon, SearchField, T } from '@/components/ui';
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

// Where the list's search field ends (the header's 4 pt padding, then the 46 pt field), and the compact navigation
// bar's height under the status bar (iOS 26). Scroll events report the header's inset as 0, so the list's position
// under the bar comes from these.
const SEARCH_BOTTOM = 50;
const NAV_BAR = 54;
const TOOLBAR_BUTTON = 52; // one button's share of the header's glass capsule

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
  const barBottom = insets.top + NAV_BAR;

  // Search is a mode over the list (see TrailSearch): opened from the list's field, or from a header button once
  // that field has scrolled away, and it grows out of whichever was tapped. The list itself is never filtered by the
  // query, so it keeps its place. `open` turns false on close; the mode ends once the field has shrunk back.
  const [search, setSearch] = useState<{ from: Rect; open: boolean } | null>(null);
  const fieldRef = useRef<View>(null);
  const { width } = useWindowDimensions();
  const openFromField = () => fieldRef.current?.measureInWindow((x, y, w, h) => setSearch({ from: { x, y, width: w, height: h }, open: true }));
  // The header's toolbar buttons can't be measured; the search button sits left of the map button in their capsule.
  const openFromButton = () => setSearch({ from: { x: width - 16 - 2 * TOOLBAR_BUTTON, y: insets.top, width: TOOLBAR_BUTTON, height: 44 }, open: true });
  const searching = Boolean(search?.open);
  const [searchAway, setSearchAway] = useState(false);
  const scrolled = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrolled.set(e.contentOffset.y + barBottom);
  });
  useAnimatedReaction(
    () => scrolled.get() > SEARCH_BOTTOM,
    (away, was) => {
      if (away !== was) scheduleOnRN(setSearchAway, away);
    },
  );
  const closeSearch = () => setSearch((s) => s && { ...s, open: false });
  const endSearch = () => {
    setSearch(null);
    setQuery('');
  };
  const toggleMode = () => {
    setQuery(''); // the map filters by it as you type; the list starts again unfiltered, at its top
    scrolled.set(0);
    setSearchAway(false);
    setMode(mode === 'list' ? 'map' : 'list');
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
      {/* Hidden while search is up: the search field grows out of it and shrinks back into it. */}
      <View ref={fieldRef} collapsable={false} style={search ? styles.hidden : undefined}>
        <SearchField value="" onChangeText={setQuery} placeholder="Search by name or place" onPress={openFromField} />
      </View>
      {filters}
      <T v="footnote" color="text2">
        {list ? `${filtered.length} official ${filtered.length === 1 ? 'trail' : 'trails'}` : ' '}
      </T>
    </View>
  );

  return (
    <>
      {/* Search is our own glass field, not the header's: the native one only turns to glass once focused.
          While searching, the large title gives way so the field sits right under the bar, as a search controller does. */}
      <Stack.Screen options={{ headerLargeTitle: !onMap && !searching }} />
      {!search ? (
        <Stack.Toolbar placement="right">
          {!onMap && searchAway ? <Stack.Toolbar.Button icon="magnifyingglass" onPress={openFromButton} accessibilityLabel="Search trails" /> : null}
          <Stack.Toolbar.Button icon={onMap ? 'list.bullet' : 'map'} onPress={toggleMode} accessibilityLabel={onMap ? 'Show as list' : 'Show on map'} />
        </Stack.Toolbar>
      ) : null}
      {!onMap ? (
        <View style={styles.flex}>
          <Animated.FlatList
            onScroll={onScroll}
            scrollEventThrottle={16}
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
          {search ? (
            <TrailSearch
              trails={filtered}
              query={query}
              onChangeQuery={setQuery}
              open={search.open}
              from={search.from}
              top={barBottom}
              within={within || undefined}
              onOpenTrail={open}
              onClose={closeSearch}
              onClosed={endSearch}
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.flex}>
          <TrailMap
            style={StyleSheet.absoluteFill}
            pins={pins.filter((t) => t.start_coord).map((t) => ({ id: t.id, coord: t.start_coord!, title: t.name, selected: t.id === selected }))}
            onPinPress={setSelected}
            padding={{ top: 190, right: 24, bottom: 170, left: 24 }}
          />
          <View style={[styles.mapTop, { top: insets.top + 56 }]} pointerEvents="box-none">
            <SearchField value={query} onChangeText={setQuery} placeholder="Search by name or place" />
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
  hidden: { opacity: 0 },
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
