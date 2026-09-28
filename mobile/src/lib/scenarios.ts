// Demo scenarios override HKO warnings / AFCD closures on the server so a refusal can be shown on cue.
export const SCENARIOS = [
  { id: 'live', label: 'Live data' },
  { id: 'clear', label: 'Clear skies' },
  { id: 't8', label: 'Typhoon T8' },
  { id: 'rainstorm', label: 'Red rainstorm' },
  { id: 'thunderstorm', label: 'Thunderstorm' },
  { id: 'closure:hk_8', label: "Dragon's Back closed" },
] as const;

export const scenarioLabel = (id: string) => SCENARIOS.find((s) => s.id === id)?.label ?? id;
