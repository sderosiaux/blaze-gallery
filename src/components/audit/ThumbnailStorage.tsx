"use client";

import { useState } from "react";
import {
  CircleCheck,
  Images,
  RefreshCw,
  TriangleAlert,
  Info,
  HardDrive,
  FileStack,
} from "lucide-react";
import { Badge, Button, Section, Skeleton, Stat } from "@/components/ui";
import type { ThumbnailCoverage, ThumbnailStorageScan } from "./types";
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatFullDay,
  formatShare,
  formatTime,
} from "./format";
import { SectionError } from "./SectionError";
import { useAuditData } from "./useAuditData";

// Listing ~11,000 thumbnails takes 15-70 s (sequential 1,000-key pages).
const SCAN_TIMEOUT_MS = 180_000;

function countedAgo(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  return `à ${formatTime(Date.parse(iso))}`;
}

function SampleList({ items, total }: { items: string[]; total: number }) {
  if (items.length === 0) return null;
  return (
    <details className="group mt-2">
      <summary className="inline-flex min-h-[32px] items-center text-sm text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink">
        {total > items.length
          ? `Afficher les ${formatCount(items.length)} premiers`
          : items.length === 1
            ? "Afficher"
            : `Afficher les ${formatCount(items.length)}`}
      </summary>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li
            key={item}
            className="truncate font-mono text-xs text-ink-soft"
            title={item}
          >
            {/* Some legacy records hold a newline; show it as a visible mark. */}
            {item.replace(/\n/g, "⏎")}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Integrity({ scan }: { scan: ThumbnailStorageScan }) {
  const { missing, orphaned } = scan;
  if (missing.count === 0 && orphaned.count === 0) {
    return (
      <Badge tone="success" icon={CircleCheck}>
        Chaque photo a sa miniature, chaque miniature a sa photo
      </Badge>
    );
  }
  return (
    <div className="grid gap-8 md:grid-cols-2">
      {missing.count > 0 && (
        <div className="min-w-0">
          <Badge tone="warning" icon={TriangleAlert}>
            {formatCount(missing.count)}{" "}
            {missing.count > 1 ? "manquantes" : "manquante"}
          </Badge>
          <p className="mt-2 text-sm text-ink-soft">
            {missing.count > 1
              ? "Photos dont la miniature n’est pas dans le stockage"
              : "Photo dont la miniature n’est pas dans le stockage"}
          </p>
          <SampleList items={missing.sample} total={missing.count} />
        </div>
      )}
      {orphaned.count > 0 && (
        <div className="min-w-0">
          <Badge tone="info" icon={Info}>
            {formatCount(orphaned.count)}{" "}
            {orphaned.count > 1 ? "inutilisées" : "inutilisée"}
          </Badge>
          <p className="mt-2 text-sm text-ink-soft">
            {orphaned.count > 1
              ? "Miniatures stockées sans photo correspondante"
              : "Miniature stockée sans photo correspondante"}
          </p>
          <SampleList items={orphaned.sample} total={orphaned.count} />
        </div>
      )}
    </div>
  );
}

export function ThumbnailStorage({ reloadKey }: { reloadKey: number }) {
  const coverage = useAuditData<ThumbnailCoverage>("/api/audit/thumbnails", {
    reloadKey,
  });
  // `recount` asks the server to list storage again instead of using its cache.
  const [recount, setRecount] = useState(0);
  const scan = useAuditData<ThumbnailStorageScan>(
    `/api/audit/thumbnails?scope=storage${recount ? `&refresh=1&n=${recount}` : ""}`,
    { reloadKey, timeoutMs: SCAN_TIMEOUT_MS },
  );

  const cov = coverage.data;
  const share =
    cov && cov.total_photos > 0 ? cov.with_thumbnail / cov.total_photos : 0;
  const s = scan.data;

  const dim = scan.loading
    ? "opacity-60 transition-opacity duration-200"
    : "transition-opacity duration-200";
  const scanStats = s ? (
    <>
      <Stat
        className={dim}
        icon={HardDrive}
        label="Stockées"
        value={formatBytes(s.total_bytes)}
        hint={
          s.mode === "s3"
            ? "Dans le bucket des miniatures"
            : "Sur le disque du serveur"
        }
      />
      <Stat
        className={dim}
        icon={FileStack}
        label="Fichiers"
        value={formatCount(s.file_count)}
        hint={
          s.file_count > 0
            ? `${formatBytes(s.total_bytes / s.file_count)} en moyenne`
            : "Aucun fichier"
        }
      />
    </>
  ) : scan.error ? null : (
    <>
      {[0, 1].map((i) => (
        <div key={i} aria-hidden>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-9 w-24" />
          <Skeleton className="mt-2 h-3 w-32" />
        </div>
      ))}
    </>
  );

  return (
    <Section
      id="thumbnails"
      title="Miniatures"
      action={
        s && (
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            loading={scan.loading}
            onClick={() => {
              setRecount((n) => n + 1);
            }}
          >
            Recompter
          </Button>
        )
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:gap-x-10 lg:grid-cols-4">
        {coverage.error ? (
          <div className="col-span-2">
            <SectionError
              title="La couverture des miniatures n’a pas chargé"
              error={coverage.error}
              onRetry={coverage.retry}
            />
          </div>
        ) : cov ? (
          <>
            <Stat
              icon={Images}
              label="Avec miniature"
              value={formatShare(share)}
              hint={
                <>
                  <span
                    role="meter"
                    aria-label="Photos avec miniature"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(share * 1000) / 10}
                    className="mb-2 mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-chart-5/15"
                  >
                    <span
                      className="block h-full rounded-full bg-chart-5"
                      style={{ width: `${Math.max(share * 100, 0.5)}%` }}
                    />
                  </span>
                  {formatCount(cov.with_thumbnail)} photos sur{" "}
                  {formatCount(cov.total_photos)}
                </>
              }
            />
            <Stat
              label="Sans miniature"
              value={formatCount(cov.without_thumbnail)}
              hint="Pas encore générées"
            />
          </>
        ) : (
          [0, 1].map((i) => (
            <div key={i} aria-hidden>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-9 w-24" />
              <Skeleton className="mt-2 h-3 w-36" />
            </div>
          ))
        )}
        {scanStats}
      </div>

      <div className="mt-8 border-t border-line pt-6">
        {scan.error ? (
          <SectionError
            title="Le comptage des fichiers stockés n’a pas abouti"
            error={scan.error}
            onRetry={scan.retry}
          />
        ) : s ? (
          <div className={dim}>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
              <span
                className="max-w-full truncate font-mono text-xs text-ink-soft"
                title={s.location}
              >
                {s.location}
              </span>
              {s.oldest && s.newest && (
                <span>
                  Écrites du {formatFullDay(Date.parse(s.oldest))} au{" "}
                  {formatFullDay(Date.parse(s.newest))}
                </span>
              )}
              <span role="status">
                {scan.loading
                  ? "Nouveau comptage, jusqu’à une minute"
                  : `Compté ${countedAgo(s.scanned_at)} en ${formatDuration(s.scan_ms)}`}
              </span>
            </p>
            {!s.directory_exists ? (
              <p className="mt-4 text-sm text-danger">
                Le dossier des miniatures n’existe pas sur le serveur.
              </p>
            ) : (
              <div className="mt-5">
                <Integrity scan={s} />
              </div>
            )}
          </div>
        ) : (
          <p role="status" className="text-sm text-ink-muted">
            Comptage des fichiers stockés, jusqu’à une minute…
          </p>
        )}
      </div>
    </Section>
  );
}
