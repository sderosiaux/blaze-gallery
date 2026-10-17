"use client";

import Link from "next/link";
import { X } from "lucide-react";
import type { Photo } from "@/types";
import { IconButton } from "@/components/ui";
import { formatNumber } from "@/lib/albums";
import { cn } from "@/lib/cn";
import { rotatedSize, userRotation } from "@/lib/rotation";
import { albumCrumbs } from "./sources";
import { formatCoordinates, formatSize } from "./format";

interface InfoPanelProps {
  id: string;
  photo: Photo;
  /** Guests never see where the folder sits in the bucket. */
  showAlbum: boolean;
  onClose: () => void;
}

function cameraName(camera?: { make?: string; model?: string }) {
  const make = camera?.make?.trim();
  const model = camera?.model?.trim();
  if (!make) return model;
  if (!model) return make;
  // "Canon" + "Canon EOS 5D" reads as "Canon EOS 5D".
  return model.toLowerCase().startsWith(make.toLowerCase().split(" ")[0] ?? "")
    ? model
    : `${make} ${model}`;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <dt className="kicker mb-1">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

export default function InfoPanel({
  id,
  photo,
  showAlbum,
  onClose,
}: InfoPanelProps) {
  const meta = photo.metadata;
  // As shown: a photo turned by hand reads the other way round
  const dims = meta?.dimensions
    ? rotatedSize(meta.dimensions, userRotation(meta))
    : undefined;
  const camera = cameraName(meta?.camera);
  const crumbs = showAlbum ? albumCrumbs(photo) : [];
  const location = meta?.location;

  return (
    <aside
      id={id}
      aria-label="Infos"
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 flex max-h-[62%] animate-rise-in flex-col rounded-t-xl bg-surface shadow-pop",
        "md:static md:max-h-none md:w-80 md:shrink-0 md:animate-fade-in md:rounded-none md:border-l md:border-line md:shadow-none",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
        <h2 className="kicker">Infos</h2>
        <IconButton
          icon={X}
          label="Masquer les infos (I)"
          size="sm"
          onClick={onClose}
          className="-mr-2"
        />
      </div>
      <div className="overflow-y-auto px-5 pb-6 pt-2">
        <dl>
          <Row label="Fichier">
            <span className="break-all">{photo.filename}</span>
          </Row>
          {dims && (
            <Row label="Dimensions">
              <span className="tabular">
                {formatNumber(dims.width)} × {formatNumber(dims.height)} px
              </span>
            </Row>
          )}
          {camera && <Row label="Appareil">{camera}</Row>}
          <Row label="Taille">
            <span className="tabular">{formatSize(Number(photo.size))}</span>
          </Row>
          {location && (
            <Row label="Lieu">
              <span className="tabular">
                {formatCoordinates(location.latitude, location.longitude)}
              </span>
              <a
                href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=15/${location.latitude}/${location.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block text-accent-strong underline underline-offset-2 hover:decoration-2"
              >
                Ouvrir dans OpenStreetMap
              </a>
            </Row>
          )}
          {crumbs.length > 0 && (
            <Row label="Dossier">
              <nav
                aria-label="Chemin du dossier"
                className="flex flex-wrap items-center gap-x-1 gap-y-0.5"
              >
                {crumbs.map((crumb, i) => (
                  <span
                    key={crumb.path}
                    className="inline-flex items-center gap-1"
                  >
                    {i > 0 && (
                      <span aria-hidden className="text-ink-faint">
                        /
                      </span>
                    )}
                    <Link
                      href={crumb.href}
                      className={cn(
                        "underline-offset-2 transition-colors hover:text-ink hover:underline",
                        i === crumbs.length - 1 ? "text-ink" : "text-ink-muted",
                      )}
                    >
                      {crumb.name}
                    </Link>
                  </span>
                ))}
              </nav>
            </Row>
          )}
        </dl>
      </div>
    </aside>
  );
}
