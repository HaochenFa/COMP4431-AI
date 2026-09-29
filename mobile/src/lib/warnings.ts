import type { SFSymbol } from 'expo-symbols';

import type { Warning } from './types';

// HKO warnings as a hiker needs them: a symbol and one practical line (HKO's own precautions, condensed).
const META: Record<string, { icon: SFSymbol; advice: string }> = {
  WHOT: { icon: 'thermometer.sun.fill', advice: 'Start early, carry extra water and keep off exposed ridges at midday.' },
  WCOLD: { icon: 'thermometer.snowflake', advice: 'Summits run several degrees colder. Pack a warm layer.' },
  WFIRE: { icon: 'flame.fill', advice: 'Hillsides are dry. No open flames in country parks.' },
  WRAIN: { icon: 'cloud.heavyrain.fill', advice: 'Streams rise within minutes. Stay off the trails.' },
  WTS: { icon: 'cloud.bolt.rain.fill', advice: 'Lightning strikes ridges and summits first. Stay off them.' },
  WL: { icon: 'exclamationmark.triangle.fill', advice: 'Keep away from steep slopes and retaining walls.' },
  WMSGNL: { icon: 'wind', advice: 'Gusts are strongest on ridges and along the coast.' },
  WFNTSA: { icon: 'water.waves', advice: 'Low-lying paths in the northern New Territories may flood.' },
  WFROST: { icon: 'snowflake', advice: 'High ground may be icy. Watch your footing.' },
  WTMW: { icon: 'water.waves', advice: 'Keep away from beaches and the shore.' },
};

function cyclone(code = ''): string {
  if (code.startsWith('TC1')) return 'A typhoon is within 800 km. Check again before you set out.';
  if (code.startsWith('TC3')) return 'Strong winds on exposed ridges. Pick a sheltered, low route.';
  return 'Stay indoors until the signal is lowered.';
}

export type WarningView = { key: string; title: string; icon: SFSymbol; advice: string; issued?: string };

export function describeWarning(key: string, w: Warning): WarningView {
  const title =
    key === 'WTCSGNL'
      ? (w.type ?? w.name ?? 'Tropical Cyclone Signal')
      : key === 'WRAIN' || key === 'WFIRE'
        ? `${w.type ?? ''} ${w.name ?? ''}`.trim()
        : (w.name ?? key);
  const meta = META[key];
  return {
    key,
    title,
    icon: key === 'WTCSGNL' ? 'hurricane' : (meta?.icon ?? 'exclamationmark.triangle.fill'),
    advice: key === 'WTCSGNL' ? cyclone(w.code) : (meta?.advice ?? 'Check the Hong Kong Observatory before you set out.'),
    issued: w.issued,
  };
}

/** "Since 11:15" today, "Since Sat 26 Sep" for an older warning. */
export function sinceLabel(iso: string | undefined, now = new Date()): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const sameDay = t.toDateString() === now.toDateString();
  return sameDay
    ? `Since ${t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : `Since ${t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

/** An HKO warning code as people know it: TC8NE → "No. 8 Gale or Storm Signal", WRAINR → "Red Rainstorm Warning". */
export function warningName(code: string): string {
  if (/^TC10/.test(code)) return 'No. 10 Hurricane Signal';
  if (/^TC9/.test(code)) return 'No. 9 Increasing Gale or Storm Signal';
  if (/^TC8/.test(code)) return 'No. 8 Gale or Storm Signal';
  if (/^TC3/.test(code)) return 'No. 3 Strong Wind Signal';
  if (/^TC1/.test(code)) return 'No. 1 Standby Signal';
  const named: Record<string, string> = {
    WRAINA: 'Amber Rainstorm Warning',
    WRAINR: 'Red Rainstorm Warning',
    WRAINB: 'Black Rainstorm Warning',
    WTS: 'Thunderstorm Warning',
    WHOT: 'Very Hot Weather Warning',
    WCOLD: 'Cold Weather Warning',
    WL: 'Landslip Warning',
  };
  return named[code] ?? code;
}
