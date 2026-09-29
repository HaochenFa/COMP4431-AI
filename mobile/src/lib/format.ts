// Display helpers. Numbers are formatted here, never computed: they come from tools and the dataset.

type Named = { name: string; trail?: string | null; section?: number | null };

/** "Hong Kong Trail · Section 8" for long-distance sections; the official name otherwise. */
export function trailTitle(t: Named): string {
  const trail = t.trail?.trim();
  return t.section && trail ? `${trail} · Section ${t.section}` : t.name.trim();
}

/** "To Tei Wan → Tai Long Wan", "Loop from X", or null when AFCD lists no end points. */
export function trailRoute(t: { start?: string | null; finish?: string | null }): string | null {
  const s = t.start?.trim();
  const f = t.finish?.trim();
  if (!s || !f) return null;
  return s === f ? `Loop from ${s}` : `${s} → ${f}`;
}

export const fmtKm = (km: number | null | undefined) => (km == null ? '–' : km < 10 ? km.toFixed(1) : String(Math.round(km)));

/** 2.25 -> "2h 15m"; 3 -> "3h". */
export function fmtHours(h: number | null | undefined): string {
  if (h == null) return '–';
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return hh ? (mm ? `${hh}h ${mm}m` : `${hh}h`) : `${mm}m`;
}

export const fmtM = (m: number | null | undefined) => (m == null ? '–' : String(Math.round(m)));
