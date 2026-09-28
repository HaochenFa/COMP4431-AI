import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Appearance } from 'react-native';

// Simulator reaches the laptop via localhost; a phone needs the laptop's LAN / hotspot IP (set in Settings).
const DEFAULT_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
const KEY = 'trailhead.settings.v1';

/** Night trail is the default look; Day (light) is for projectors; System follows iOS. */
export type AppearanceSetting = 'dark' | 'light' | 'system';

export type Settings = { backendUrl: string; speakReplies: boolean; sessionId: string; appearance: AppearanceSetting };

type Ctx = { settings: Settings; update: (patch: Partial<Settings>) => void; ready: boolean };
const SettingsContext = createContext<Ctx | null>(null);

const newSessionId = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// Overrides the window's interface style, so native tabs, headers and glass follow it too.
// (react-native-web has no setColorScheme; the web preview just follows the browser.)
const applyAppearance = (a: AppearanceSetting) => Appearance.setColorScheme?.(a === 'system' ? 'unspecified' : a);
applyAppearance('dark'); // before the first frame, so a stored preference is the only possible change

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>({
    backendUrl: DEFAULT_URL,
    speakReplies: true,
    sessionId: newSessionId(),
    appearance: 'dark',
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setSettings((s) => ({ ...s, ...JSON.parse(raw) })))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => applyAppearance(settings.appearance), [settings.appearance]);

  // Persist what's committed, and only once the stored copy has loaded, so a write can't clobber it with defaults.
  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify(settings)).catch(() => {});
  }, [ready, settings]);

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  return <SettingsContext.Provider value={{ settings, update, ready }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings outside SettingsProvider');
  return ctx;
}

export { newSessionId };
