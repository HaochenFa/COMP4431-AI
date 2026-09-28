import Constants from 'expo-constants';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type EdgePadding } from 'react-native-maps';

import { useTheme } from '@/constants/theme';
import type { LatLng, TrackRole } from '@/lib/types';

const HK = { latitude: 22.36, longitude: 114.14, latitudeDelta: 0.55, longitudeDelta: 0.55 };
const useGoogle = Boolean(Constants.expoConfig?.extra?.hasGoogleMaps);
const toLatLng = ([latitude, longitude]: LatLng) => ({ latitude, longitude });

export type MapTrack = { id: string; name?: string; role: TrackRole; segments: LatLng[][] };
export type MapPin = { id: string; coord: LatLng; title: string; selected?: boolean };
export type MapLayer = 'map' | 'satellite';

/**
 * A map as a mode, not a canvas: used full screen (/map, the Trails map) or as a still preview card.
 * Apple Maps' muted style keeps the base quiet so the routes carry the colour; it follows light/dark.
 */
export function TrailMap({
  tracks = [],
  pins = [],
  interactive = true,
  layer = 'map',
  padding = { top: 60, right: 40, bottom: 60, left: 40 },
  onPinPress,
  style,
}: {
  tracks?: MapTrack[];
  pins?: MapPin[];
  interactive?: boolean;
  layer?: MapLayer;
  padding?: EdgePadding;
  onPinPress?: (id: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, dark } = useTheme();
  const map = useRef<MapView>(null);
  const color: Record<TrackRole, string> = { primary: c.accent, backup: c.info, rejected: c.danger };

  // Frame the primary route (else every route, else the pins) whenever what's drawn changes.
  const focus = tracks.filter((t) => t.role === 'primary');
  const coords = (focus.length ? focus : tracks).flatMap((t) => t.segments.flat()).map(toLatLng);
  const fitKey = tracks.length ? tracks.map((t) => t.id).join(',') : `pins:${pins.length}`;
  const fit = () => {
    const target = coords.length ? coords : pins.map((p) => toLatLng(p.coord));
    if (target.length > 1) map.current?.fitToCoordinates(target, { edgePadding: padding, animated: interactive });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fit, [fitKey]);

  const mapType = layer === 'satellite' ? 'hybrid' : useGoogle ? 'terrain' : 'mutedStandard';

  return (
    <View style={style} pointerEvents={interactive ? 'auto' : 'none'}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        provider={useGoogle ? PROVIDER_GOOGLE : undefined}
        mapType={mapType}
        userInterfaceStyle={dark ? 'dark' : 'light'}
        initialRegion={HK}
        onMapReady={fit}
        showsPointsOfInterests={false}
        showsBuildings={false}
        showsCompass={interactive}
        showsScale={interactive}
        toolbarEnabled={false}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        pitchEnabled={interactive}
        rotateEnabled={interactive}>
        {tracks.flatMap((t) => {
          const width = t.role === 'primary' ? 5 : 3.5;
          return t.segments.flatMap((seg, i) => {
            const line = seg.map(toLatLng);
            return [
              <Polyline key={`${t.id}-${i}-case`} coordinates={line} strokeColor={c.routeCase} strokeWidth={width + 3} zIndex={1} />,
              <Polyline
                key={`${t.id}-${i}`}
                coordinates={line}
                strokeColor={color[t.role]}
                strokeWidth={width}
                lineDashPattern={t.role === 'rejected' ? [6, 6] : undefined}
                zIndex={t.role === 'primary' ? 3 : 2}
              />,
            ];
          });
        })}
        {tracks
          .filter((t) => t.role !== 'rejected' && t.segments.length)
          .flatMap((t) => {
            const first = t.segments[0][0];
            const lastSeg = t.segments[t.segments.length - 1];
            const last = lastSeg[lastSeg.length - 1];
            return [
              <Marker
                key={`${t.id}-start`}
                coordinate={toLatLng(first)}
                title={`Start · ${t.name ?? ''}`}
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={t.role === 'primary' ? 6 : 4}>
                <View style={[styles.pin, { backgroundColor: color[t.role], borderColor: c.routeCase }]}>
                  <SymbolView name="figure.hiking" size={13} tintColor={t.role === 'primary' ? c.onAccent : c.bg} weight="bold" />
                </View>
              </Marker>,
              // Only the plan gets a finish flag: backups often end where the plan starts (HK Trail 7 → 8).
              t.role === 'primary' && (
                <Marker key={`${t.id}-finish`} coordinate={toLatLng(last)} title={`Finish · ${t.name ?? ''}`} anchor={{ x: 0.5, y: 0.5 }} zIndex={5}>
                  <View style={[styles.pin, { backgroundColor: c.text, borderColor: c.routeCase }]}>
                    <SymbolView name="flag.checkered" size={12} tintColor={c.bg} weight="bold" />
                  </View>
                </Marker>
              ),
            ];
          })}
        {pins.map((p) => (
          <Marker key={p.id} coordinate={toLatLng(p.coord)} anchor={{ x: 0.5, y: 0.5 }} onPress={() => onPinPress?.(p.id)} zIndex={p.selected ? 10 : 1}>
            <View style={[p.selected ? styles.pinSelected : styles.dot, { backgroundColor: p.selected ? c.accent : c.text, borderColor: c.routeCase }]} />
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  pinSelected: { width: 20, height: 20, borderRadius: 10, borderWidth: 3 },
});
