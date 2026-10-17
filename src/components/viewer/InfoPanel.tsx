"use client";

import Link from "next/link";
import { X } from "lucide-react";
import type { Photo } from "@/types";
import { IconButton } from "@/components/ui";
import { formatFileSize } from "@/lib/format";
import { cn } from "@/lib/cn";
import { albumCrumbs, isRawFile } from "./sources";
import { formatTaken } from "./format";

interface InfoPanelProps {
  id: string;
  photo: Photo;
  /** Guests never see where the album sits in the library. */
  showAlbum: boolean;
  onClose: () => void;
}

function cameraName(camera?: { make?: string; model?: string }) {
  const make = camera?.make?.trim();
  const model = camera?.model?.trim();
  if (!make) return model;
  if (!model) return make;
  // "Canon" + "Canon EOS 5D" reads as "Canon EOS 5D".
  return model.toLowerCase().startsWith(make.toLowerCase().split(" ")[0]) ? model : `${make} ${model}`;
}

function fileType(photo: Photo) {
  const ext = photo.filename.includes(".")
    ? photo.filename.split(".").pop()!.toUpperCase()
    : photo.mime_type.split("/")[1]?.toUpperCase();
  if (isRawFile(photo)) return `${ext}, RAW`;
  return ext === "JPG" ? "JPEG" : ext;
}

function coordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <dt className="kicker mb-1">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

export default function InfoPanel({ id, photo, showAlbum, onClose }: InfoPanelProps) {
  const meta = photo.metadata;
  const dims = meta?.dimensions;
  const camera = cameraName(meta?.camera);
  const crumbs = showAlbum ? albumCrumbs(photo) : [];
  const taken = meta?.date_taken ? formatTaken(meta.date_taken) : null;
  const location = meta?.location;
  const megapixels = dims ? (dims.width * dims.height) / 1_000_000 : 0;
  const stillReading = !meta && (photo.metadata_status === "none" || photo.metadata_status === "pending");

  return (
    <aside
      id={id}
      aria-label="Photo details"
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 flex max-h-[62%] animate-rise-in flex-col rounded-t-xl bg-surface shadow-pop",
        "md:static md:max-h-none md:w-80 md:shrink-0 md:animate-fade-in md:rounded-none md:border-l md:border-line md:shadow-none",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
        <h2 className="kicker">Details</h2>
        <IconButton icon={X} label="Hide details (I)" size="sm" onClick={onClose} className="-mr-2" />
      </div>
      <div className="overflow-y-auto px-5 pb-6">
        <p className="mb-4 break-all font-display text-xl font-normal leading-snug text-ink">{photo.filename}</p>
        <dl>
          <Row label="Taken">
            {taken ? (
              <>
                {taken.day}
                {taken.time && <span className="text-ink-muted"> at {taken.time}</span>}
              </>
            ) : (
              <span className="text-ink-muted">
                {stillReading ? "Not read yet. It fills in on its own." : "Not recorded"}
              </span>
            )}
          </Row>
          {crumbs.length > 0 && (
            <Row label="Album">
              <nav aria-label="Albums containing this photo" className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                {crumbs.map((crumb, i) => (
                  <span key={crumb.path} className="inline-flex items-center gap-1">
                    {i > 0 && (
                      <span aria-hidden className="text-ink-faint">
                        /
                      </span>
                    )}
                    <Link
                      href={crumb.href}
                      className={cn(
                        "underline-offset-2 transition-colors hover:text-accent-strong hover:underline",
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
          {dims && (
            <Row label="Dimensions">
              <span className="tabular">
                {dims.width.toLocaleString("en-GB")} × {dims.height.toLocaleString("en-GB")} px
              </span>
              {megapixels >= 0.1 && <span className="tabular text-ink-muted"> · {megapixels.toFixed(1)} MP</span>}
            </Row>
          )}
          {camera && <Row label="Camera">{camera}</Row>}
          <Row label="File">
            <span className="tabular">{formatFileSize(Number(photo.size))}</span>
            <span className="text-ink-muted"> · {fileType(photo)}</span>
          </Row>
          {location && (
            <Row label="Location">
              <span className="tabular">
                {coordinate(location.latitude, "N", "S")}, {coordinate(location.longitude, "E", "W")}
              </span>
              <a
                href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=15/${location.latitude}/${location.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block text-accent-strong underline-offset-2 hover:underline"
              >
                Open in OpenStreetMap
              </a>
            </Row>
          )}
        </dl>
      </div>
    </aside>
  );
}
