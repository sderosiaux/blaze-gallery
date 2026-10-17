"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge, Section, Skeleton, Stat } from "@/components/ui";
import { formatCount, formatDay } from "@/lib/albums";
import { Meter } from "./charts";
import { formatNumber, formatPercent, formatSize, timeAgo } from "./format";
import {
  BarsSkeleton,
  SectionTitleSkeleton,
  StatsRowSkeleton,
  TabError,
} from "./TabState";
import type { HealthStats, IgnoredFiles } from "./types";
import { useStatsResource } from "./useStatsResource";

const cell = "border-t border-line pt-4";

// The API names its categories in English; the ids are stable.
const IGNORED_LABELS: Record<string, string> = {
  synology_thumbnails: "Miniatures Synology",
  system_files: "Fichiers système et cachés",
  eadir_folders: "Fichiers des dossiers @eaDir",
  small_files: "Fichiers de moins de 10 Ko",
};

export default function HealthTab({ active }: { active: boolean }) {
  const health = useStatsResource<HealthStats>("/api/stats/health", active);
  const ignored = useStatsResource<IgnoredFiles>(
    "/api/stats/ignored-files",
    active,
  );

  return (
    <div>
      {health.state.status === "error" ? (
        <TabError
          title="Les chiffres de santé n’ont pas chargé"
          error={health.state.error}
          onRetry={health.retry}
          className="py-6"
        />
      ) : health.state.status !== "ready" ? (
        <div
          role="status"
          aria-label="Chargement de la santé"
          className="grid gap-x-12 lg:grid-cols-2"
        >
          {[0, 1].map((i) => (
            <div key={i} className="py-8 sm:py-10">
              <SectionTitleSkeleton />
              {i === 0 ? <BarsSkeleton rows={4} /> : <StatsRowSkeleton />}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid animate-fade-in gap-x-12 lg:grid-cols-2">
          <MetadataSection data={health.state.data.metadata} />
          <SyncSection data={health.state.data.sync} />
        </div>
      )}

      <Section
        title="Fichiers ignorés"
        description="Exclus de la recherche de doublons"
      >
        {ignored.state.status === "error" ? (
          <TabError
            title="Les fichiers ignorés n’ont pas chargé"
            error={ignored.state.error}
            onRetry={ignored.retry}
          />
        ) : ignored.state.status !== "ready" ? (
          <div
            role="status"
            aria-label="Chargement des fichiers ignorés"
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={cell}>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-3 h-6 w-20" />
                <Skeleton className="mt-3 h-3 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <IgnoredList data={ignored.state.data} />
        )}
      </Section>
    </div>
  );
}

function MetadataSection({ data }: { data: HealthStats["metadata"] }) {
  const rows = [
    { label: "Dimensions", value: data.with_dimensions },
    { label: "Date de prise de vue", value: data.with_date },
    { label: "Appareil", value: data.with_camera },
    { label: "Lieu", value: data.with_location },
  ];
  return (
    <Section
      title="Métadonnées"
      description="Lues dans l’en-tête de chaque photo"
    >
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
              <span className="text-ink">{r.label}</span>
              <span className="tabular text-ink-soft">
                {formatPercent(r.value, data.images)}
                <span className="text-ink-muted">
                  {" "}
                  · {formatNumber(r.value)}
                </span>
              </span>
            </div>
            <Meter
              value={r.value}
              total={data.images}
              label={`${r.label} : ${formatNumber(r.value)} photos sur ${formatNumber(data.images)}`}
            />
          </li>
        ))}
      </ul>
      <div className="mt-8 grid grid-cols-3 gap-x-6">
        <Stat
          className={cell}
          label="À lire"
          value={formatNumber(data.pending)}
        />
        <Stat
          className={cell}
          label="Illisibles"
          value={formatNumber(data.failed)}
          hint="En-tête inutilisable"
        />
        <Stat
          className={cell}
          label="Vidéos"
          value={formatNumber(data.videos)}
          hint="Non lues pour l’instant"
        />
      </div>
    </Section>
  );
}

function SyncSection({ data }: { data: HealthStats["sync"] }) {
  const outOfDate = data.stale + data.never_synced > 0;
  return (
    <Section
      title="Synchronisation"
      description="Avec le bucket"
      action={
        outOfDate ? (
          <Badge tone="warning" icon={AlertTriangle}>
            En retard
          </Badge>
        ) : (
          <Badge tone="success" icon={CheckCircle2}>
            À jour
          </Badge>
        )
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-8">
        <Stat
          label="Dernière synchro"
          value={data.last_synced ? timeAgo(data.last_synced) : "Jamais"}
          hint={data.last_synced ? formatDay(data.last_synced) : undefined}
        />
        <Stat label="Dossiers" value={formatNumber(data.total_folders)} />
        <Stat
          label="Vérifiés cette semaine"
          value={formatNumber(data.synced_last_week)}
          hint={`${formatNumber(data.synced_last_day)} aujourd’hui`}
        />
        <Stat
          label="En retard"
          value={formatNumber(data.stale + data.never_synced)}
          hint={
            data.never_synced > 0
              ? `Non vérifiés depuis une semaine, ${formatNumber(data.never_synced)} jamais`
              : "Non vérifiés depuis une semaine"
          }
        />
      </div>
      {outOfDate && (
        <p className="mt-6 max-w-xl text-pretty text-sm text-ink-soft">
          {data.last_synced
            ? `Les photos ajoutées au bucket après le ${formatDay(data.last_synced)} n’apparaissent pas.`
            : "Lancer une synchronisation complète."}
        </p>
      )}
    </Section>
  );
}

function IgnoredList({ data }: { data: IgnoredFiles }) {
  if (data.breakdown.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-soft">
        <Badge tone="success" icon={CheckCircle2}>
          Aucun
        </Badge>
      </p>
    );
  }
  return (
    <div className="animate-fade-in">
      <p className="tabular mb-5 text-sm text-ink-soft">
        {formatCount(data.summary.total_ignored_files, "fichier")},{" "}
        {formatSize(data.summary.total_ignored_size_bytes)} en tout
      </p>
      <ul className="grid gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        {data.breakdown.map((c) => (
          <li key={c.category} className={`${cell} min-w-0`}>
            <div className="text-sm text-ink">
              {IGNORED_LABELS[c.category] ?? c.label}
            </div>
            <div className="tabular mt-1 font-display text-2xl font-semibold text-ink">
              {formatNumber(c.count)}
            </div>
            <div className="tabular text-xs text-ink-muted">
              {formatSize(c.total_size_bytes)}
            </div>
            {c.examples.length > 0 && (
              <ul className="mt-3 space-y-0.5">
                {c.examples.map((e) => (
                  <li
                    key={e}
                    className="truncate font-mono text-xs text-ink-muted"
                    title={e}
                  >
                    {e}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
