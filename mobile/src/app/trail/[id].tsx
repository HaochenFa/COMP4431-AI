import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { ActionBar } from '@/components/plan/sections';
import { ElevationChart } from '@/components/trail/elevation-chart';
import { TrailHero } from '@/components/trail/trail-hero';
import { TrailMap } from '@/components/trail/trail-map';
import { Button, Card, Chip, Icon, ListRow, ListSection, Press, SectionTitle, StatRow, T } from '@/components/ui';
import { difficultyTone, radius, useTheme } from '@/constants/theme';
import { useAgent } from '@/lib/agent';
import { fmtHours, fmtKm, fmtM, trailRoute, trailTitle } from '@/lib/format';
import { useTrailDetail, useTrails } from '@/lib/trails';

/** One official trail, AllTrails-style: hero, stats, elevation, map preview, then hand off to the agent. */
export default function TrailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const agent = useAgent();
  const { byId } = useTrails();
  const { trail, failed } = useTrailDetail(id);
  const [more, setMore] = useState(false);
  const y = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    y.value = e.contentOffset.y;
  });
  const meta = byId[id];

  if (!trail) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        {failed ? (
          <>
            <Icon name="wifi.exclamationmark" size={30} color="text3" />
            <T v="headline">Can&apos;t load this trail</T>
          </>
        ) : (
          <ActivityIndicator color={c.text2} />
        )}
      </View>
    );
  }

  const title = trailTitle(trail);
  const diff = difficultyTone(trail.difficulty, c);
  const plan = () => {
    agent.setDraft(`Plan ${trail.name} for `);
    router.push('/chat');
  };
  const askAbout = (q: string) => {
    if (!agent.send(q)) agent.setDraft(q);
    router.push('/chat');
  };

  return (
    <View style={[styles.flex, { backgroundColor: c.bg }]}>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.scroll}>
        <TrailHero
          id={trail.id}
          segments={trail.segments}
          scrollY={y}
          title={title}
          subtitle={trailRoute(trail)}
          badge={<Chip tone="glass" label={trail.region} icon="mappin.and.ellipse" />}
        />
        <View style={styles.body}>
          <View style={styles.tags}>
            <View style={[styles.dot, { backgroundColor: diff.color }]} />
            <T v="subhead" color="text2" style={styles.flex}>
              <T v="subhead" weight="600">
                {diff.label}
              </T>
              {[trail.type, trail.stars ? `AFCD rating ${trail.stars}/5` : null]
                .filter(Boolean)
                .map((s) => ` · ${s}`)
                .join('')}
            </T>
          </View>
          {trail.landmarks?.length ? (
            <View style={styles.landmarks}>
              <Icon name="binoculars" size={14} color="text2" />
              <T v="subhead" color="text2" style={styles.flex}>
                {trail.landmarks.join(' · ')}
              </T>
            </View>
          ) : null}

          <StatRow
            items={[
              { value: fmtKm(trail.length_km), unit: 'km', label: 'Length' },
              { value: fmtHours(trail.official_hours ?? meta?.hours), label: 'Official time' },
              { value: fmtM(trail.profile?.ascent_m), unit: 'm', label: 'Climb' },
              { value: fmtM(trail.profile?.max_m), unit: 'm', label: 'High point' },
            ]}
          />

          {trail.profile ? (
            <Card style={styles.pad}>
              <ElevationChart profile={trail.profile} />
            </Card>
          ) : null}

          {trail.segments.length ? (
            <View>
              <SectionTitle>Route</SectionTitle>
              <Press onPress={() => router.push({ pathname: '/map', params: { trail: trail.id } })} accessibilityRole="button" accessibilityLabel="Open the map">
                <TrailMap
                  tracks={[{ id: trail.id, name: trail.name, role: 'primary', segments: trail.segments }]}
                  interactive={false}
                  padding={{ top: 30, right: 30, bottom: 30, left: 30 }}
                  style={styles.preview}
                />
                <View style={styles.expand}>
                  <Chip tone="glass" icon="arrow.up.left.and.arrow.down.right" label="Open map" />
                </View>
              </Press>
            </View>
          ) : null}

          {trail.description_zh ? (
            <View>
              <SectionTitle>From AFCD</SectionTitle>
              <T v="body" color="text2" numberOfLines={more ? undefined : 4} lang="zh-Hant">
                {trail.description_zh}
              </T>
              <View style={styles.links}>
                <Button title={more ? 'Less' : 'More'} variant="ghost" onPress={() => setMore(!more)} style={styles.link} />
                <Button
                  title="Summarise in English"
                  variant="ghost"
                  icon="text.bubble"
                  onPress={() => askAbout(`What will I see on ${trail.name}? Summarise the official description.`)}
                  style={styles.link}
                />
              </View>
            </View>
          ) : null}

          <ListSection inset={52}>
            {trail.url ? <ListRow icon="safari" title="Open on hiking.gov.hk" accessory="link" onPress={() => WebBrowser.openBrowserAsync(trail.url!)} /> : null}
            <ListRow icon="questionmark.bubble" title="Is it OK this weekend?" accessory="chevron" onPress={() => askAbout(`Is ${trail.name} OK to hike this weekend?`)} />
          </ListSection>
        </View>
      </Animated.ScrollView>
      <ActionBar>
        <Button title="Plan this hike" icon="figure.hiking" onPress={plan} style={styles.flex} />
      </ActionBar>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  scroll: { paddingBottom: 120 },
  body: { padding: 16, paddingTop: 18, gap: 28 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: -8 },
  landmarks: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: -8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pad: { padding: 16 },
  preview: { height: 200, borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden' },
  expand: { position: 'absolute', right: 10, bottom: 10 },
  links: { flexDirection: 'row', marginLeft: -22, marginTop: 2 },
  link: { height: 40 },
});
