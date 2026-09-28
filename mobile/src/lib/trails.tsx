import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { useAgent } from './agent';
import { useSettings } from './settings';
import type { Conditions, TrailDetail, TrailSummary } from './types';

// The official trail list and details over REST (backend/app/rest.py), cached for the session.
type Ctx = {
  list: TrailSummary[] | null;
  byId: Record<string, TrailSummary>;
  error: boolean;
  reload: () => void;
  detail: (id: string) => Promise<TrailDetail>;
  cached: (id: string) => TrailDetail | undefined;
  photo: (id: string, size: 'thumb' | 'hero') => string | null;
  base: string;
};

const TrailsContext = createContext<Ctx | null>(null);

export function TrailsProvider({ children }: { children: ReactNode }) {
  const { settings, ready } = useSettings();
  const base = settings.backendUrl.replace(/\/$/, '');
  const [list, setList] = useState<TrailSummary[] | null>(null);
  const [byId, setById] = useState<Record<string, TrailSummary>>({});
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const details = useRef(new Map<string, { promise: Promise<TrailDetail>; value?: TrailDetail }>());

  useEffect(() => {
    if (!ready) return;
    let live = true;
    details.current.clear();
    fetch(`${base}/trails`)
      .then((r) => (r.ok ? (r.json() as Promise<TrailSummary[]>) : Promise.reject(new Error(String(r.status)))))
      .then((rows) => {
        if (!live) return;
        setError(false);
        setList(rows);
        setById(Object.fromEntries(rows.map((t) => [t.id, t])));
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [base, ready, attempt]);

  const detail = useCallback(
    (id: string) => {
      const hit = details.current.get(id);
      if (hit) return hit.promise;
      const entry: { promise: Promise<TrailDetail>; value?: TrailDetail } = {
        promise: fetch(`${base}/trails/${encodeURIComponent(id)}`).then((r) =>
          r.ok ? (r.json() as Promise<TrailDetail>) : Promise.reject(new Error(String(r.status))),
        ),
      };
      entry.promise.then(
        (v) => (entry.value = v),
        () => details.current.delete(id), // let the next call retry
      );
      details.current.set(id, entry);
      return entry.promise;
    },
    [base],
  );

  const cached = useCallback((id: string) => details.current.get(id)?.value, []);

  const photo = useCallback(
    (id: string, size: 'thumb' | 'hero') => {
      const has = byId[id]?.photo ?? details.current.get(id)?.value?.photo;
      return has ? `${base}/photos/${size === 'thumb' ? 'thumb/' : ''}${encodeURIComponent(id)}.jpg` : null;
    },
    [base, byId],
  );

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return <TrailsContext.Provider value={{ list, byId, error, reload, detail, cached, photo, base }}>{children}</TrailsContext.Provider>;
}

export function useTrails() {
  const ctx = useContext(TrailsContext);
  if (!ctx) throw new Error('useTrails outside TrailsProvider');
  return ctx;
}

/** One trail's full record (segments + elevation profile), fetched once and cached. */
export function useTrailDetail(id: string | undefined) {
  const { detail, cached } = useTrails();
  const [value, setValue] = useState<TrailDetail | undefined>(id ? cached(id) : undefined);
  const [failedId, setFailedId] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    detail(id).then(
      (v) => live && setValue(v),
      () => live && setFailedId(id),
    );
    return () => {
      live = false;
    };
  }, [id, detail]);
  return { trail: value?.id === id ? value : id ? cached(id) : undefined, failed: failedId === id };
}

/** Today's and the weekend's HKO conditions under the session's demo scenario; refreshed on focus. */
export function useConditions() {
  const { base } = useTrails();
  const { settings } = useSettings();
  const { scenario, connected } = useAgent();
  const [conditions, setConditions] = useState<Conditions | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let live = true;
    fetch(`${base}/conditions?session=${encodeURIComponent(settings.sessionId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Conditions>) : Promise.reject(new Error(String(r.status)))))
      .then((v) => {
        if (!live) return;
        setConditions(v);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // scenario / connected: a new demo scenario or a reconnect changes what the server reports
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, settings.sessionId, scenario, connected]);

  useFocusEffect(load);
  return { conditions, failed };
}
