// Palette from the project poster: trail-post yellow on country-park green.
export const C = {
  ink: '#14261f',
  moss: '#2f5a45',
  water: '#1c6a7a',
  post: '#f0b429',
  refuse: '#c4452e',
  paper: '#e7eedc',
  card: '#f7faf1',
  line: '#c5d2b8',
  muted: '#5b6b62',
  white: '#ffffff',
} as const;

export const TRACK_COLOR = { primary: C.post, backup: C.water, rejected: C.refuse } as const;

export const TOOL_LABEL: Record<string, string> = {
  search_trails: 'Search trails',
  get_trail: 'Trail record',
  check_closures: 'AFCD closures',
  get_weather: 'HKO weather',
  get_daylight: 'Sunset',
  maps_draw_gpx: 'Draw track',
  ask_user: 'Question',
  load_skill: 'Skill',
  present_plan: 'Plan',
  refuse: 'No-go',
};
