import { Stack, router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View, type FlatList, type TextInput } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrailFeature, TrailRow } from '@/components/trail/trail-row';
import { TrailMap } from '@/components/trail/trail-map';
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

// The search field's top and bottom in the list (the header's 4 pt padding, then the 46 pt field).
const SEARCH_TOP = 4;
const SEARCH_HEIGHT = 46;
const SEARCH_BOTTOM = SEARCH_TOP + SEARCH_HEIGHT;
// The compact navigation bar under the status bar (iOS 26); the pinned field's gap below it, and the results' below the field.
const NAV_BAR = 54;
const PIN_GAP = 8;
const RESULTS_GAP = 10;

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
  const searchRef = useRef<TextInput>(null);
  // Once the search field has scrolled away, a header button brings it back where the list is: the field slides
  // down and pins under the header, and the list stays put. It unpins when it loses focus with nothing typed.
  const [searchAway, setSearchAway] = useState(false);
  const [pinned, setPinned] = useState(false);
  // The list position under the compact header: content y = 0 at its bottom edge, negative while the large title shows.
  // (Scroll events report the header's inset as 0, so it comes from the safe area and the bar's height.)
  const scrolled = useSharedValue(0);
  const pin = useSharedValue(0);
  const barBottom = insets.top + NAV_BAR;

  const onScroll = useAnimatedScrollHandler((e) => {
    scrolled.set(e.contentOffset.y + barBottom);
  });
  useAnimatedReaction(
    () => scrolled.get() > SEARCH_BOTTOM,
    (away, was) => {
      if (away !== was) scheduleOnRN(setSearchAway, away);
    },
  );
  // Pinned, the field moves down with the scroll, so it stays PIN_GAP under the header.
  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(0, scrolled.get() + PIN_GAP - SEARCH_TOP) * pin.get() }] }));
  const focusSearch = () => searchRef.current?.focus();
  const openSearch = () => {
    setPinned(true);
    // Focus once the field is in view: iOS scrolls a focused field that is off screen back into view.
    pin.set(
      withTiming(1, { duration: 220 }, (done) => {
        if (done) scheduleOnRN(focusSearch);
      }),
    );
  };
  const closeSearch = () => {
    setPinned(false);
    pin.set(withTiming(0, { duration: 220 }));
  };
  const listRef = useRef<FlatList<TrailSummary>>(null);
  const headerHeight = useRef(0);
  const changeQuery = (text: string) => {
    setQuery(text);
    if (!text && !searchRef.current?.isFocused()) closeSearch(); // cleared with the keyboard down
    // Typing in the pinned field: show the results from the first one, just under the field.
    const firstResult = headerHeight.current - (PIN_GAP + SEARCH_HEIGHT + RESULTS_GAP);
    if (pinned && scrolled.get() > firstResult) listRef.current?.scrollToOffset({ offset: firstResult - barBottom, animated: false });
  };
  const toggleMode = () => {
    // The list remounts at its top, so start it unpinned.
    closeSearch();
    scrolled.set(0);
    setSearchAway(false);
    setMode(mode === 'list' ? 'map' : 'list');
  };

  const q = query.trim().toLowerCase();
  const shown = (list ?? []).filter(
    (t) =>
      (!difficulty || matchesDifficulty(t, difficulty)) &&
      (!region || t.region === region) &&
      (!q || [t.name, t.trail, t.start, t.finish, t.region, ...t.landmarks, ...t.search_zh].some((s) => s?.toLowerCase().includes(q))),
  );
  // Found by a landmark, not its name ("Dragon" → Hong Kong Trail · Section 8): say which one.
  const note = (t: TrailSummary) => (q ? t.landmarks.find((l) => l.toLowerCase().includes(q)) : undefined);
  const open = (t: TrailSummary) => router.push(`/trail/${t.id}`);
  const picked = shown.find((t) => t.id === selected);

  const onMap = mode === 'map';
  const search = (
    <SearchField ref={searchRef} value={query} onChangeText={changeQuery} onBlur={() => !query && closeSearch()} placeholder="Search by name or place" />
  );
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
    <View style={styles.filters} onLayout={(e) => (headerHeight.current = e.nativeEvent.layout.height)}>
      <Animated.View style={[styles.pinned, pinStyle]}>{search}</Animated.View>
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
        {!onMap && searchAway && !pinned ? <Stack.Toolbar.Button icon="magnifyingglass" onPress={openSearch} accessibilityLabel="Search trails" /> : null}
        <Stack.Toolbar.Button
          icon={mode === 'list' ? 'map' : 'list.bullet'}
          onPress={toggleMode}
          accessibilityLabel={mode === 'list' ? 'Show on map' : 'Show as list'}
        />
      </Stack.Toolbar>
      {mode === 'list' ? (
        <Animated.FlatList
          ref={listRef}
          onScroll={onScroll}
          // An empty search lets go when the list is dragged, with or without an on-screen keyboard to dismiss.
          onScrollBeginDrag={() => !query && searchRef.current?.blur()}
          scrollEventThrottle={16}
          style={{ backgroundColor: c.bg }}
          contentInsetAdjustmentBehavior="automatic"
          data={shown}
          keyExtractor={(t) => t.id}
          ListHeaderComponent={header}
          ListHeaderComponentStyle={styles.header}
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
            padding={{ top: 190, right: 24, bottom: 170, left: 24 }}
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
  // Above the rows, so the pinned field floats over them.
  header: { zIndex: 1 },
  pinned: { zIndex: 1 },
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
