"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Library, Palette, RotateCcw } from "lucide-react";
import {
  Button,
  ButtonLink,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import ProgressiveImage from "@/components/photos/ProgressiveImage";
import FilterBar from "@/components/find/FilterBar";
import { LoadError } from "@/components/find/LoadError";
import { asArray, asString, isRecord, readJsonObject } from "@/hooks/apiJson";
import { formatCount, formatNumber } from "@/lib/albums";
import {
  HUE_LABELS,
  isColorTone,
  isHue,
  TONE_LABELS,
  type ColorTone,
  type Hue,
} from "@/lib/colors";
import {
  filterKey,
  filterQuery,
  hasUrlFilter,
  NO_URL_FILTER,
  type UrlFilter,
} from "@/lib/photoFilter";
import { thumbnailUrl } from "@/lib/photoUrls";
import { asQuarterTurn, type QuarterTurn } from "@/lib/rotation";

interface BandPhoto {
  id: number;
  hex: string | null;
  rotation: QuarterTurn;
}

type Band =
  | { kind: "color"; key: Hue; photos: BandPhoto[] }
  | { kind: "tone"; key: ColorTone; photos: BandPhoto[] };

interface Overview {
  bands: Band[];
  coverage: { measured: number; photos: number } | null;
}

const HEX = /^#[0-9a-f]{6}$/i;

function readBandPhoto(value: unknown): BandPhoto | null {
  if (!isRecord(value) || typeof value.id !== "number") return null;
  return {
    id: value.id,
    hex:
      typeof value.hex === "string" && HEX.test(value.hex) ? value.hex : null,
    rotation: asQuarterTurn(value.rotation),
  };
}

function readBand(value: unknown): Band | null {
  if (!isRecord(value)) return null;
  const photos = asArray(value.photos)
    .map(readBandPhoto)
    .filter((photo): photo is BandPhoto => photo !== null);
  if (value.kind === "color" && isHue(value.key))
    return { kind: "color", key: value.key, photos };
  if (value.kind === "tone" && isColorTone(value.key))
    return { kind: "tone", key: value.key, photos };
  return null;
}

async function fetchOverview(
  filter: UrlFilter,
  signal: AbortSignal,
): Promise<Overview> {
  const query = filterQuery(filter).toString();
  const response = await fetch(
    `/api/colors/overview${query ? `?${query}` : ""}`,
    { signal },
  );
  const data = await readJsonObject(response);
  if (!response.ok || !data.success)
    throw new Error(asString(data.error) ?? `HTTP ${response.status}`);
  const coverage = data.coverage;
  return {
    bands: asArray(data.bands)
      .map(readBand)
      .filter((band): band is Band => band !== null),
    coverage:
      isRecord(coverage) &&
      typeof coverage.measured === "number" &&
      typeof coverage.photos === "number"
        ? { measured: coverage.measured, photos: coverage.photos }
        : null,
  };
}

/** Tiles fill the row at about this width; the rest of a band's photos wait for a wider screen. */
const TILE_COLUMNS =
  "grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]";

function BandRow({
  band,
  index,
  filter,
}: {
  band: Band;
  index: number;
  filter: UrlFilter;
}) {
  const label =
    band.kind === "color" ? HUE_LABELS[band.key] : TONE_LABELS[band.key];
  const params = filterQuery(filter);
  params.set(band.kind === "color" ? "color" : "tone", band.key);
  const href = `/couleurs?${params.toString()}`;
  return (
    <li>
      <Link
        href={href}
        className="group grid items-center gap-x-6 gap-y-2 rounded-md focus-visible:outline-offset-4 sm:grid-cols-[8.5rem_minmax(0,1fr)]"
      >
        <span className="flex items-center justify-between gap-2 sm:justify-start">
          <span className="font-display text-lg font-semibold text-ink">
            {label}
          </span>
          <ArrowRight
            className="h-4 w-4 text-ink-faint transition-[color,transform] duration-200 ease-out-soft group-hover:translate-x-1 group-hover:text-ink"
            aria-hidden
          />
        </span>
        {/* One row: tiles past the width fall into rows of no height */}
        <span
          aria-hidden
          className={`grid auto-rows-[0] grid-rows-1 gap-x-1 overflow-hidden rounded-md ${TILE_COLUMNS}`}
        >
          {band.photos.map((photo, i) => (
            <span key={photo.id} className="relative aspect-square">
              <ProgressiveImage
                thumbSrc={thumbnailUrl(photo.id, undefined, photo.rotation)}
                thumbReady
                displayWidth={160}
                alt=""
                eager={index < 4}
                order={index * 12 + i}
                placeholderColor={photo.hex ?? undefined}
                className="transition-transform duration-700 ease-out-soft group-hover:scale-[1.03]"
              />
            </span>
          ))}
        </span>
      </Link>
    </li>
  );
}

function BandsSkeleton({ count }: { count: number }) {
  return (
    <ul
      role="status"
      aria-label="Chargement des couleurs"
      className="space-y-5 sm:space-y-6"
    >
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          aria-hidden
          className="grid items-center gap-x-6 gap-y-2 sm:grid-cols-[8.5rem_minmax(0,1fr)]"
        >
          <Skeleton className="h-5 w-20" />
          <span
            className={`grid auto-rows-[0] grid-rows-1 gap-x-1 overflow-hidden rounded-md ${TILE_COLUMNS}`}
          >
            {Array.from({ length: 12 }).map((_, j) => (
              <Skeleton key={j} className="aspect-square rounded-none" />
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The nuancier: one band per color, then per tone, each showing the photos
 * holding most of it among those the filter keeps, and opening all of
 * them. Colors not met in those photos are left out.
 */
export default function ColorBands({
  filter,
  onFilterChange,
}: {
  filter: UrlFilter;
  onFilterChange: (next: UrlFilter) => void;
}) {
  const [overview, setOverview] = useState<Overview | "error" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = filterKey(filter);
  const filtered = hasUrlFilter(filter);

  useEffect(() => {
    const controller = new AbortController();
    setOverview(null);
    fetchOverview(filter, controller.signal)
      .then(setOverview)
      .catch(() => {
        if (!controller.signal.aborted) setOverview("error");
      });
    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key says when the filter changed
  }, [attempt, key]);

  const coverage = overview && overview !== "error" ? overview.coverage : null;
  const header = (
    <>
      <PageHeader
        title="Couleurs"
        meta={
          coverage && (
            <span className="tabular">
              Couleurs lues sur {formatNumber(coverage.measured)} des{" "}
              {formatCount(coverage.photos, "photo")}
            </span>
          )
        }
      />
      <FilterBar filter={filter} onChange={onFilterChange} className="mb-8" />
    </>
  );

  if (overview === "error") {
    return (
      <>
        {header}
        <LoadError
          title="Les couleurs n'ont pas pu être chargées"
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      </>
    );
  }

  if (overview === null) {
    return (
      <>
        {header}
        <BandsSkeleton count={6} />
      </>
    );
  }

  const shown = overview.bands.filter((band) => band.photos.length > 0);
  const colors = shown.filter((band) => band.kind === "color");
  const tones = shown.filter((band) => band.kind === "tone");

  if (shown.length === 0 && filtered) {
    return (
      <>
        {header}
        <EmptyState
          icon={Palette}
          title="Aucune photo pour ce filtre"
          action={
            <Button
              variant="secondary"
              icon={RotateCcw}
              onClick={() => {
                onFilterChange(NO_URL_FILTER);
              }}
            >
              Effacer le filtre
            </Button>
          }
          className="py-20"
        />
      </>
    );
  }

  if (shown.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={Palette}
          title="Aucune couleur lue pour l'instant"
          body="Les photos viennent ici à mesure que le worker lit leurs couleurs."
          action={
            <ButtonLink href="/" variant="secondary" icon={Library}>
              Ouvrir la bibliothèque
            </ButtonLink>
          }
          className="py-20"
        />
      </>
    );
  }

  return (
    <>
      {header}
      <ul className="space-y-5 sm:space-y-6">
        {colors.map((band, i) => (
          <BandRow key={band.key} band={band} index={i} filter={filter} />
        ))}
      </ul>
      {tones.length > 0 && (
        <section aria-labelledby="tons" className="mt-14">
          <h2 id="tons" className="kicker mb-5">
            Tons
          </h2>
          <ul className="space-y-5 sm:space-y-6">
            {tones.map((band, i) => (
              <BandRow
                key={band.key}
                band={band}
                index={colors.length + i}
                filter={filter}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
