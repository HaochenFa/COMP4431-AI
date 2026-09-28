import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import type { Outcome } from './types';

// Plans and refusals kept on the device. The chat itself is cleared on every reconnect (the server
// replays only a pending question), so this is what lets Home list recent plans and a plan page reopen.
const KEY = 'trailhead.recent.v1';
const KEEP = 10;

type Ctx = { recent: Outcome[]; add: (o: Outcome) => void; get: (id: string) => Outcome | undefined };
const RecentContext = createContext<Ctx | null>(null);

export function RecentProvider({ children }: { children: ReactNode }) {
  const [recent, setRecent] = useState<Outcome[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setRecent((cur) => merge(cur, JSON.parse(raw) as Outcome[])))
      .catch(() => {});
  }, []);

  const add = useCallback((o: Outcome) => {
    setRecent((cur) => {
      const next = merge([o], cur);
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const get = useCallback((id: string) => recent.find((o) => o.id === id), [recent]);

  return <RecentContext.Provider value={{ recent, add, get }}>{children}</RecentContext.Provider>;
}

/** Newest first, one entry per id, at most KEEP. */
function merge(first: Outcome[], rest: Outcome[]): Outcome[] {
  const seen = new Set<string>();
  return [...first, ...rest].filter((o) => !seen.has(o.id) && seen.add(o.id)).slice(0, KEEP);
}

export function useRecent() {
  const ctx = useContext(RecentContext);
  if (!ctx) throw new Error('useRecent outside RecentProvider');
  return ctx;
}
