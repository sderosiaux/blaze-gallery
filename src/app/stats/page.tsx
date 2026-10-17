"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { PageHeader, PageSkeleton, Tabs } from "@/components/ui";
import StatsOverview from "@/components/stats/StatsOverview";
import StorageTab from "@/components/stats/StorageTab";
import VideosTab from "@/components/stats/VideosTab";
import DuplicatesTab from "@/components/stats/DuplicatesTab";
import HealthTab from "@/components/stats/HealthTab";
import { STATS_TABS, parseTab, type StatsTab } from "@/components/stats/tabs";
import { formatTime } from "@/components/stats/format";
import type { StatsSummary } from "@/components/stats/types";
import { useStatsResource } from "@/components/stats/useStatsResource";

// The backfill keeps filling metadata in the background: the headline numbers
// refresh on this beat while the page is visible, without a loading flash.
const SUMMARY_REFRESH_MS = 60_000;
const TAB_GRACE_MS = 1_500;

function StatsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));
  const tabsRef = useRef<HTMLDivElement>(null);

  // A tab loads its data the first time it is shown, then stays mounted
  // (hidden) so coming back to it is instant and never refetches.
  const [visited, setVisited] = useState<ReadonlySet<StatsTab>>(
    () => new Set([tab]),
  );
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab]);

  const summary = useStatsResource<StatsSummary>("/api/stats", true);
  const { refresh } = summary;
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, SUMMARY_REFRESH_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [refresh]);

  // The headline numbers go first: tab queries wait for them to settle (or
  // for a short grace period) so they don't compete for the same database.
  const [grace, setGrace] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setGrace(true);
    }, TAB_GRACE_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, []);
  const tabsMayLoad =
    grace ||
    summary.state.status === "ready" ||
    summary.state.status === "error";

  const openTab = useCallback(
    (next: StatsTab, opts?: { reveal?: boolean }) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      if (opts?.reveal)
        tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [pathname, router, searchParams],
  );

  const s = summary.state.status === "ready" ? summary.state.data : undefined;

  return (
    <>
      <PageHeader
        title="Statistiques"
        meta={
          <span className="tabular">
            {s
              ? `Compté à ${formatTime(s.generated_at)}`
              : summary.state.status === "error"
                ? "Comptage indisponible"
                : "Comptage…"}
          </span>
        }
      />

      <StatsOverview
        summary={summary.state}
        onRetry={summary.retry}
        onOpenTab={(next) => {
          openTab(next, { reveal: true });
        }}
      />

      <div ref={tabsRef} className="mt-10 scroll-mt-24">
        <Tabs
          label="Sections des statistiques"
          tabs={STATS_TABS.map((t) => ({ id: t.id, label: t.label }))}
          value={tab}
          onChange={(next) => {
            openTab(next);
          }}
        />
      </div>

      {STATS_TABS.map(({ id, label }) =>
        visited.has(id) ? (
          <div key={id} role="tabpanel" aria-label={label} hidden={tab !== id}>
            {id === "storage" && (
              <StorageTab active={tabsMayLoad} totalBytes={s?.storage_bytes} />
            )}
            {id === "videos" && <VideosTab active={tabsMayLoad} />}
            {id === "duplicates" && (
              <DuplicatesTab
                active={tabsMayLoad}
                files={s ? s.photos + s.videos : undefined}
              />
            )}
            {id === "health" && <HealthTab active={tabsMayLoad} />}
          </div>
        ) : null,
      )}
    </>
  );
}

export default function StatsPage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <Suspense fallback={<PageSkeleton rows={2} />}>
          <StatsContent />
        </Suspense>
      </ProtectedRoute>
    </AppLayout>
  );
}
