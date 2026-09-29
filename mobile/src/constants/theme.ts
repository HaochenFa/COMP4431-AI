// "Night trail": dark-first and photo-led, with one lime accent. "Day trail" (light) is for projectors.
// Colour carries meaning: accent = go / the primary action / the primary route; caution, danger = safety.
import type { SFSymbol } from 'expo-symbols';
import { useColorScheme, type TextStyle } from 'react-native';

const night = {
  bg: '#0E110F',
  surface: '#1A1E1B',
  surface2: '#232925',
  separator: '#2A302C',
  text: '#EEF1EC',
  text2: '#98A197',
  text3: '#687168',
  accent: '#B7E36B',
  onAccent: '#1B2410',
  accentSoft: 'rgba(183,227,107,0.14)',
  caution: '#FFC24B',
  cautionSoft: 'rgba(255,194,75,0.14)',
  danger: '#FF6B5B',
  dangerSoft: 'rgba(255,107,91,0.14)',
  info: '#7CC4E8',
  routeCase: '#0E110F',
};

const day: typeof night = {
  bg: '#F4F6F3',
  surface: '#FFFFFF',
  surface2: '#EDF0EC',
  separator: '#DDE2DC',
  text: '#111512',
  text2: '#5E675F',
  text3: '#8A938B',
  accent: '#4F7A12',
  onAccent: '#FFFFFF',
  accentSoft: 'rgba(79,122,18,0.12)',
  caution: '#A86A00',
  cautionSoft: 'rgba(168,106,0,0.12)',
  danger: '#C4372B',
  dangerSoft: 'rgba(196,55,43,0.10)',
  info: '#1F6F99',
  routeCase: '#FFFFFF',
};

export type Colors = typeof night;
export type Theme = { dark: boolean; c: Colors };

const NIGHT: Theme = { dark: true, c: night };
const DAY: Theme = { dark: false, c: day };

/** Follows the app appearance (Settings → Appearance sets it with Appearance.setColorScheme). */
export function useTheme(): Theme {
  return useColorScheme() === 'light' ? DAY : NIGHT;
}

// HIG text styles (size / line height), system SF.
export const type = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400' },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  stat: { fontSize: 22, lineHeight: 26, fontWeight: '600', fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { control: 10, card: 16, sheet: 24, pill: 999 } as const;

type ToolMeta = { label: string; icon: SFSymbol; hidden?: boolean; doing: (args: Record<string, unknown>) => string };

const onDate = (args: Record<string, unknown>) => (typeof args.date === 'string' ? ` for ${shortDate(args.date)}` : '');

// How each tool reads in the agent's activity row. `doing` names the real task (HIG: no vague "Processing…").
export const TOOL_META: Record<string, ToolMeta> = {
  search_trails: { label: 'Official trails', icon: 'magnifyingglass', doing: (a) => `Searching official trails${typeof a.region === 'string' ? ` in ${a.region}` : ''}` },
  get_trail: { label: 'Trail record', icon: 'signpost.right', doing: () => 'Reading the AFCD trail record' },
  search_knowledge: { label: 'Trail notes', icon: 'text.book.closed', doing: () => 'Reading AFCD trail descriptions' },
  check_closures: { label: 'AFCD closures', icon: 'exclamationmark.octagon', doing: () => 'Checking AFCD closures' },
  get_weather: { label: 'HKO forecast', icon: 'cloud.sun', doing: (a) => `Checking the HKO forecast${onDate(a)}` },
  get_daylight: { label: 'Sunset', icon: 'sunset', doing: (a) => `Checking sunset${onDate(a)}` },
  maps_draw_gpx: { label: 'Route', icon: 'point.topleft.down.to.point.bottomright.curvepath', hidden: true, doing: () => 'Drawing the route' },
  load_skill: { label: 'Safety guide', icon: 'book.closed', hidden: true, doing: () => 'Reading the safety guide' },
  ask_user: { label: 'Question', icon: 'questionmark.bubble', hidden: true, doing: () => 'Asking you' },
  present_plan: { label: 'Safety gate', icon: 'checkmark.shield', hidden: true, doing: () => 'Putting the plan together' },
  refuse: { label: 'Safety gate', icon: 'hand.raised', hidden: true, doing: () => 'Writing up the no-go' },
};

export const toolMeta = (name: string): ToolMeta =>
  TOOL_META[name] ?? { label: name.replace(/_/g, ' '), icon: 'wrench.and.screwdriver', doing: () => `Running ${name.replace(/_/g, ' ')}` };

export const REFUSAL_LABEL: Record<string, string> = {
  CLOSED: 'Trail closed',
  WARNING_T8: 'Typhoon signal',
  RAINSTORM: 'Rainstorm warning',
  THUNDERSTORM: 'Thunderstorm warning',
  EXTREME_HEAT: 'Too hot',
  EXCEEDS_ABILITY: 'Too hard',
  AFTER_DARK: 'Finishes after dark',
  INSUFFICIENT_TIME: 'Not enough time',
  OUT_OF_SCOPE: 'Not a hiking question',
};

/** AFCD difficulty as a word plus a colour (never colour alone). */
export function difficultyTone(d: string | undefined, c: Colors): { label: string; color: string } {
  switch (d) {
    case 'Easy':
      return { label: 'Easy', color: c.accent };
    case 'Moderate':
      return { label: 'Moderate', color: c.info };
    case 'Demanding':
      return { label: 'Demanding', color: c.caution };
    case 'Difficult':
    case 'Very difficult':
      return { label: d, color: c.danger };
    default:
      return { label: 'Unrated', color: c.text3 };
  }
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-03" -> "Sat 3 Oct" (the date is a Hong Kong calendar date; no time zone maths). */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[dow]} ${d} ${MONTHS[m - 1]}`;
}
