import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Simulator reaches the laptop via localhost; a phone needs the laptop's LAN / hotspot IP (set in Settings).
const DEFAULT_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
const KEY = 'trailhead.settings.v1';

export type Settings = { backendUrl: string; speakReplies: boolean; sessionId: string };

type Ctx = { settings: Settings; update: (patch: Partial<Settings>) => void; ready: boolean };
const SettingsContext = createContext<Ctx | null>(null);

const newSessionId = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>({ backendUrl: DEFAULT_URL, speakReplies: true, sessionId: newSessionId() });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setSettings((s) => ({ ...s, ...JSON.parse(raw) })))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const update = (patch: Partial<Settings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });

  return <SettingsContext.Provider value={{ settings, update, ready }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings outside SettingsProvider');
  return ctx;
}

export { newSessionId };
