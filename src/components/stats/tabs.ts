export const STATS_TABS = [
  { id: "storage", label: "Stockage" },
  { id: "videos", label: "Vidéos" },
  { id: "duplicates", label: "Doublons" },
  { id: "health", label: "Santé" },
] as const;

export type StatsTab = (typeof STATS_TABS)[number]["id"];

export const DEFAULT_TAB: StatsTab = "storage";

export function parseTab(value: string | null): StatsTab {
  return STATS_TABS.some((t) => t.id === value)
    ? (value as StatsTab)
    : DEFAULT_TAB;
}

export function tabLabel(tab: StatsTab): string {
  return STATS_TABS.find((t) => t.id === tab)?.label ?? tab;
}
