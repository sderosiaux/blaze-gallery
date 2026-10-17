"use client";

import { useState } from "react";
import { CircleCheck, Images, RefreshCw, TriangleAlert, Info, HardDrive, FileStack } from "lucide-react";
import { Badge, Button, Section, Skeleton, Stat } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import type { ThumbnailCoverage, ThumbnailStorageScan } from "./types";
import { formatCount, formatDuration, formatFullDay, formatShare, formatTime } from "./format";
import { SectionError } from "./SectionError";
import { useAuditData } from "./useAuditData";

// Listing ~11,000 thumbnails takes 15-70 s (sequential 1,000-key pages).
const SCAN_TIMEOUT_MS = 180_000;

function countedAgo(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `at ${formatTime(Date.parse(iso))}`;
}

function SampleList({ items, total }: { items: string[]; total: number }) {
  if (items.length === 0) return null;
  return (
    <details className="group mt-2">
      <summary className="inline-flex min-h-[32px] items-center text-sm text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink">
        {total > items.length ? `Show the first ${items.length}` : `Show ${items.length === 1 ? "it" : `all ${items.length}`}`}
      </summary>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item} className="truncate font-mono text-xs text-ink-soft" title={item}>
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
        Every photo record has its file, and every file has its record
      </Badge>
    );
  }
  return (
    <div className="grid gap-8 md:grid-cols-2">
      {missing.count > 0 && (
        <div className="min-w-0">
          <Badge tone="warning" icon={TriangleAlert}>
            {formatCount(missing.count)} missing
          </Badge>
          <p className="mt-2 text-sm text-ink-soft">
            {missing.count === 1 ? "A photo record points" : `${formatCount(missing.count)} photo records point`} to a
            thumbnail that is not in storage.
          </p>
          <SampleList items={missing.sample} total={missing.count} />
        </div>
      )}
      {orphaned.count > 0 && (
        <div className="min-w-0">
          <Badge tone="info" icon={Info}>
            {formatCount(orphaned.count)} unused
          </Badge>
          <p className="mt-2 text-sm text-ink-soft">
            {orphaned.count === 1 ? "A file in storage is" : `${formatCount(orphaned.count)} files in storage are`} not
            referenced by any photo.
          </p>
          <SampleList items={orphaned.sample} total={orphaned.count} />
        </div>
      )}
    </div>
  );
}

export function ThumbnailStorage({ reloadKey }: { reloadKey: number }) {
  const coverage = useAuditData<ThumbnailCoverage>("/api/audit/thumbnails", { reloadKey });
  // `recount` asks the server to list storage again instead of using its cache.
  const [recount, setRecount] = useState(0);
  const scan = useAuditData<ThumbnailStorageScan>(
    `/api/audit/thumbnails?scope=storage${recount ? `&refresh=1&n=${recount}` : ""}`,
    { reloadKey, timeoutMs: SCAN_TIMEOUT_MS },
  );

  const cov = coverage.data;
  const share = cov && cov.total_photos > 0 ? cov.with_thumbnail / cov.total_photos : 0;
  const s = scan.data;

  const dim = scan.loading ? "opacity-60 transition-opacity duration-200" : "transition-opacity duration-200";
  const scanStats = s ? (
    <>
      <Stat
        className={dim}
        icon={HardDrive}
        label="Stored"
        value={formatBytes(s.total_bytes)}
        hint={s.mode === "s3" ? "In the thumbnail bucket" : "On the server disk"}
      />
      <Stat
        className={dim}
        icon={FileStack}
        label="Files"
        value={formatCount(s.file_count)}
        hint={s.file_count > 0 ? `${formatBytes(s.total_bytes / s.file_count)} each on average` : "No files yet"}
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
      title="Thumbnail storage"
      description="The small copies the grids load first, kept apart from the originals."
      action={
        s && (
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            loading={scan.loading}
            onClick={() => setRecount((n) => n + 1)}
          >
            Count again
          </Button>
        )
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:gap-x-10 lg:grid-cols-4">
        {coverage.error ? (
          <div className="col-span-2">
            <SectionError title="Thumbnail coverage did not load" error={coverage.error} onRetry={coverage.retry} />
          </div>
        ) : cov ? (
          <>
            <Stat
              icon={Images}
              label="With a thumbnail"
              value={formatShare(share)}
              hint={
                <>
                  <span
                    role="meter"
                    aria-label="Photos with a thumbnail"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(share * 1000) / 10}
                    className="mb-2 mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-accent-soft"
                  >
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(share * 100, 0.5)}%` }} />
                  </span>
                  {formatCount(cov.with_thumbnail)} of {formatCount(cov.total_photos)} photos
                </>
              }
            />
            <Stat
              label="Without a thumbnail"
              value={formatCount(cov.without_thumbnail)}
              hint="Not generated yet"
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
          <SectionError title="Counting the stored files did not finish" error={scan.error} onRetry={scan.retry} />
        ) : s ? (
          <div className={dim}>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
              <span className="max-w-full truncate font-mono text-xs text-ink-soft" title={s.location}>
                {s.location}
              </span>
              {s.oldest && s.newest && (
                <span>
                  Written between {formatFullDay(Date.parse(s.oldest))} and {formatFullDay(Date.parse(s.newest))}
                </span>
              )}
              <span role="status">
                {scan.loading
                  ? "Counting again, this takes up to a minute"
                  : `Counted ${countedAgo(s.scanned_at)}, in ${formatDuration(s.scan_ms)}`}
              </span>
            </p>
            {!s.directory_exists ? (
              <p className="mt-4 text-sm text-danger">The thumbnail folder does not exist on the server.</p>
            ) : (
              <div className="mt-5">
                <Integrity scan={s} />
              </div>
            )}
          </div>
        ) : (
          <p role="status" className="text-sm text-ink-muted">
            Counting the files in storage. This lists every thumbnail
            {cov ? `, about ${formatCount(cov.with_thumbnail)} of them,` : ""} and takes up to a minute.
          </p>
        )}
      </div>
    </Section>
  );
}
