import Constants from 'expo-constants';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { C, TRACK_COLOR } from '@/constants/palette';
import type { Track } from '@/lib/types';

const HK = { latitude: 22.36, longitude: 114.14, latitudeDelta: 0.5, longitudeDelta: 0.5 };
const useGoogle = Boolean(Constants.expoConfig?.extra?.hasGoogleMaps);

const toLatLng = ([latitude, longitude]: [number, number]) => ({ latitude, longitude });

export function MapCanvas({ tracks, bottomInset }: { tracks: Track[]; bottomInset: number }) {
  const map = useRef<MapView>(null);

  // Frame the newest primary (or whatever was drawn last) whenever the tracks change.
  useEffect(() => {
    const focus = [...tracks].reverse().find((t) => t.role === 'primary') ?? tracks[tracks.length - 1];
    if (!focus) return;
    map.current?.fitToCoordinates(focus.coords.map(toLatLng), {
      edgePadding: { top: 80, right: 40, bottom: bottomInset + 40, left: 40 },
      animated: true,
    });
  }, [tracks, bottomInset]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        provider={useGoogle ? PROVIDER_GOOGLE : undefined}
        mapType={useGoogle ? 'terrain' : 'standard'}
        initialRegion={HK}
        showsCompass={false}
        toolbarEnabled={false}>
        {tracks.map((t) => {
          const coords = t.coords.map(toLatLng);
          const dashed = t.role !== 'primary';
          return [
            // Dark casing under the coloured line, like a trail on a topo map.
            <Polyline key={`${t.trail_id}-case`} coordinates={coords} strokeColor={C.ink} strokeWidth={t.role === 'primary' ? 8 : 5} zIndex={1} />,
            <Polyline
              key={`${t.trail_id}-line`}
              coordinates={coords}
              strokeColor={TRACK_COLOR[t.role]}
              strokeWidth={t.role === 'primary' ? 5 : 3}
              lineDashPattern={dashed ? [8, 6] : undefined}
              zIndex={2}
            />,
            ...t.markers.map((m) => (
              <Marker key={`${t.trail_id}-${m.kind}`} coordinate={toLatLng(m.coord)} title={m.label} description={t.name} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={[styles.pin, { backgroundColor: m.kind === 'start' ? TRACK_COLOR[t.role] : C.ink }]}>
                  <Text style={[styles.pinText, { color: m.kind === 'start' ? C.ink : C.white }]}>{m.kind === 'start' ? 'S' : 'F'}</Text>
                </View>
              </Marker>
            )),
          ];
        })}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.white, alignItems: 'center', justifyContent: 'center' },
  pinText: { fontSize: 11, fontWeight: '800' },
});
