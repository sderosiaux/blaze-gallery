export const STATS_TABS = [
  { id: "storage", label: "Storage" },
  { id: "videos", label: "Videos" },
  { id: "duplicates", label: "Duplicates" },
  { id: "health", label: "Health" },
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
