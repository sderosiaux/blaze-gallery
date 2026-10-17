"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Copy, ExternalLink, RotateCw, Search, Share2, X } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import {
  Button,
  ButtonLink,
  EmptyState,
  IconButton,
  Input,
  PageHeader,
  Skeleton,
  Stat,
  Tabs,
  useToast,
  type TabItem,
} from "@/components/ui";
import ProgressiveImage from "@/components/photos/ProgressiveImage";
import { albumHref } from "@/components/photos/AlbumCard";
import RevokeDialog from "@/components/sharing/RevokeDialog";
import { ShareBadges } from "@/components/sharing/ShareBadges";
import { expiryLabel, formatInstant, lastOpenedLabel, relativeTime, shortDay } from "@/components/sharing/shareFormat";
import { useCopyLink } from "@/components/sharing/useCopyLink";
import { albumDateLabel, formatCount, parseAlbumName } from "@/lib/albums";
import { folderNameOf, listShares, shareState, shareUrl, type ShareLink, type ShareState } from "@/lib/shareClient";

type Filter = "all" | ShareState;

export default function SharedLinksPage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <SharedLinks />
      </ProtectedRoute>
    </AppLayout>
  );
}

function SharedLinks() {
  const toast = useToast();
  const [shares, setShares] = useState<ShareLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [revoking, setRevoking] = useState<ShareLink | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setShares(await listShares());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  useEffect(() => {
    document.title = "Shared links · Blaze Gallery";
    load();
  }, [load]);

  const states = useMemo(() => new Map((shares ?? []).map((s) => [s.share_token, shareState(s)])), [shares]);

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, expired: 0, revoked: 0 };
    states.forEach((state) => {
      c.all += 1;
      c[state] += 1;
    });
    return c;
  }, [states]);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return (shares ?? []).filter((s) => {
      if (filter !== "all" && states.get(s.share_token) !== filter) return false;
      if (!q) return true;
      return [s.folder_name, s.folder_path, s.description].some((v) => v?.toLocaleLowerCase().includes(q));
    });
  }, [shares, states, filter, query]);

  const onRevoked = (revoked: ShareLink) => {
    setShares((all) => all?.map((s) => (s.share_token === revoked.share_token ? { ...s, is_active: false } : s)) ?? all);
    setRevoking(null);
    toast.show("Link revoked", "success");
  };

  if (error && !shares) {
    return (
      <>
        <Header />
        <EmptyState
          icon={AlertCircle}
          title="Your shared links didn't load"
          body="Your links are fine. The page just couldn't reach them. Try again in a moment."
          action={
            <Button variant="primary" icon={RotateCw} onClick={load}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  if (!shares) return <SharedLinksSkeleton />;

  if (shares.length === 0) {
    return (
      <>
        <Header />
        <EmptyState
          icon={Share2}
          title="No shared links yet"
          body="Open an album and choose Share to send it to family or friends. Every link you create shows up here, with how often it was opened and when."
          action={
            <ButtonLink href="/" variant="primary">
              Go to the library
            </ButtonLink>
          }
          className="py-20"
        />
      </>
    );
  }

  const totalViews = shares.reduce((sum, s) => sum + s.view_count, 0);
  const protectedActive = shares.filter((s) => s.has_password && states.get(s.share_token) === "active").length;
  const lastOpened = shares.reduce<string | null>(
    (latest, s) => (s.last_accessed && (!latest || s.last_accessed > latest) ? s.last_accessed : latest),
    null,
  );

  const tabs: TabItem<Filter>[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "active", label: "Active", count: counts.active },
    { id: "expired", label: "Expired", count: counts.expired },
    { id: "revoked", label: "Revoked", count: counts.revoked },
  ];

  return (
    <>
      <Header />

      <div className="grid grid-cols-2 gap-x-6 gap-y-6 border-y border-line py-6 lg:grid-cols-4">
        <Stat label="Active links" value={counts.active} hint={`of ${formatCount(counts.all, "link")}`} />
        <Stat label="Protected" value={protectedActive} hint="active links with a password" />
        <Stat label="Views" value={totalViews.toLocaleString("en-GB")} hint="across every link" />
        <Stat
          label="Last opened"
          value={lastOpened ? shortDay(lastOpened) : "Never"}
          hint={lastOpened ? relativeTime(lastOpened) : "No guest has opened a link yet"}
        />
      </div>

      <div className="mt-10 flex flex-col-reverse gap-4 md:flex-row md:items-end md:justify-between">
        <Tabs tabs={tabs} value={filter} onChange={setFilter} label="Filter links" className="md:flex-1" />
        <div className="relative w-full md:mb-2 md:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input
            type="text"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an album or a note"
            aria-label="Find a link by album or note"
            className="pl-9"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title={query ? `No links match “${query.trim()}”` : `No ${filter} links`}
          body={query ? "Try another album name or a word from the note." : EMPTY_FILTER[filter]}
          action={
            <Button
              variant="secondary"
              icon={X}
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Show all links
            </Button>
          }
        />
      ) : (
        <ShareList shares={visible} states={states} onRevoke={setRevoking} />
      )}

      <RevokeDialog share={revoking} onClose={() => setRevoking(null)} onRevoked={onRevoked} />
    </>
  );
}

const EMPTY_FILTER: Record<Filter, string> = {
  all: "Share an album to create your first link.",
  active: "Every link has expired or been revoked. Share an album again to send a fresh one.",
  expired: "Links with an end date move here once that day has passed.",
  revoked: "Links you revoke stay listed here, so you can see they are off.",
};

function Header() {
  return (
    <PageHeader
      kicker="Sharing"
      title="Shared links"
      meta={<span>Albums you have sent to family and friends. You can revoke a link at any time.</span>}
    />
  );
}

const COLUMNS = "xl:grid xl:grid-cols-[minmax(0,1fr)_13rem_11rem_8.5rem] xl:items-center xl:gap-6";

function ShareList({
  shares,
  states,
  onRevoke,
}: {
  shares: ShareLink[];
  states: Map<string, ShareState>;
  onRevoke: (share: ShareLink) => void;
}) {
  return (
    <div className="mt-2">
      <div aria-hidden className={`kicker hidden border-b border-line py-3 ${COLUMNS}`}>
        <span>Album</span>
        <span>Status</span>
        <span>Activity</span>
        <span className="text-right">Actions</span>
      </div>
      <ul className="divide-y divide-line border-b border-line">
        {shares.map((share, i) => (
          <ShareRow key={share.share_token} share={share} state={states.get(share.share_token) ?? "active"} index={i} onRevoke={onRevoke} />
        ))}
      </ul>
    </div>
  );
}

function AlbumThumb({ share, title }: { share: ShareLink; title: string }) {
  const [failed, setFailed] = useState(false);
  const cover = failed ? null : share.cover_photo_id;
  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-surface-sunken sm:h-16 sm:w-16">
      {cover ? (
        <ProgressiveImage
          previewSrc={`/api/photos/${cover}/preview`}
          thumbSrc={`/api/photos/${cover}/thumbnail`}
          displayWidth={64}
          alt=""
          onFailed={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden className="absolute inset-0 flex select-none items-center justify-center font-display text-2xl font-light italic text-ink-faint">
          {title.charAt(0)}
        </span>
      )}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-ink/5" />
    </div>
  );
}

function ShareRow({
  share,
  state,
  index,
  onRevoke,
}: {
  share: ShareLink;
  state: ShareState;
  index: number;
  onRevoke: (share: ShareLink) => void;
}) {
  const copy = useCopyLink();
  const name = share.folder_name || folderNameOf(share.folder_path);
  const { title } = parseAlbumName(name);
  const dateLabel = albumDateLabel({ name, date_from: share.date_from ?? null, date_to: share.date_to ?? null });
  const parent = share.folder_path.split("/").slice(0, -1).join(" / ");
  const active = state === "active";
  const url = () => shareUrl(share.share_token);

  return (
    <li
      data-share-token={share.share_token}
      className={`animate-rise-in py-5 ${COLUMNS} flex flex-col gap-3`}
      style={{ animationDelay: `${Math.min(index, 10) * 25}ms` }}
    >
      <div className="flex min-w-0 items-center gap-4">
        <AlbumThumb share={share} title={title} />
        <div className={`min-w-0 ${active ? "" : "opacity-75"}`}>
          {dateLabel && <div className="kicker mb-0.5 truncate">{dateLabel}</div>}
          <h3 className="truncate font-display text-xl font-normal leading-snug text-ink">
            <Link href={albumHref(share.folder_path)} className="transition-colors hover:text-accent-strong" title={share.folder_path}>
              {title}
            </Link>
          </h3>
          {parent && <p className="truncate text-xs text-ink-muted">{parent}</p>}
          {share.description && (
            <p className="mt-1 line-clamp-1 text-sm italic text-ink-soft" title={share.description}>
              “{share.description}”
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-[4.5rem] sm:pl-20 xl:block xl:space-y-1.5 xl:pl-0">
        <ShareBadges share={share} />
        <p className="text-xs text-ink-muted">{state === "revoked" ? `Created ${formatInstant(share.created_at)}` : expiryLabel(share)}</p>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 pl-[4.5rem] sm:pl-20 xl:block xl:pl-0">
        <p className="tabular text-sm text-ink">{formatCount(share.view_count, "view")}</p>
        <p className="text-xs text-ink-muted">{lastOpenedLabel(share)}</p>
      </div>

      {/* A dead link has no actions; below xl its badge already says so. */}
      <div className={`items-center gap-1 pl-[3.75rem] sm:pl-[4.25rem] xl:flex xl:justify-end xl:pl-0 ${active ? "flex" : "hidden"}`}>
        {active ? (
          <>
            <IconButton icon={Copy} label={`Copy link to ${title}`} onClick={() => copy(url())} />
            <IconButton
              icon={ExternalLink}
              label={`Open ${title} as a guest`}
              onClick={() => window.open(url(), "_blank", "noopener,noreferrer")}
            />
            <Button variant="ghost" size="sm" onClick={() => onRevoke(share)}>
              Revoke
            </Button>
          </>
        ) : (
          <span className="px-3 text-xs text-ink-faint">{state === "expired" ? "Link has expired" : "Link is off"}</span>
        )}
      </div>
    </li>
  );
}

function SharedLinksSkeleton() {
  return (
    <>
      <Header />
      <div role="status" aria-label="Loading shared links">
      <div className="grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="mb-3 h-3 w-24" />
            <Skeleton className="h-9 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-10 h-8 w-80 max-w-full" />
      <ul className="mt-4 divide-y divide-line">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 py-5">
            <Skeleton className="h-16 w-16 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-5 w-56 max-w-full" />
            </div>
            <Skeleton className="hidden h-5 w-24 sm:block" />
          </li>
        ))}
      </ul>
      </div>
    </>
  );
}
