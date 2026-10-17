"use client";

import { useState } from "react";
import { Folder } from "@/types";
import { Calendar, Clock, HardDrive, Eye } from "lucide-react";
import { formatBytes } from "@/lib/format";

interface FolderTooltipProps {
  folder: Folder;
  children: React.ReactNode;
}

function formatDate(dateString: string | undefined): string {
  if (!dateString) return "Never";

  // Timestamps are stored without a zone, in UTC: treat a bare one as UTC.
  const date =
    dateString.includes("T") || dateString.includes("Z")
      ? new Date(dateString)
      : new Date(dateString + "Z");
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;

  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function FolderTooltip({ folder, children }: FolderTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  const rows = [
    { icon: Eye, label: "Visited", value: formatDate(folder.last_visited) },
    { icon: Clock, label: "Synced", value: formatDate(folder.last_synced) },
    { icon: HardDrive, label: "Size", value: formatBytes(folder.total_size) },
    { icon: Calendar, label: "Created", value: formatDate(folder.folder_created_at || folder.created_at) },
  ];

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}

      {isVisible && (
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-overlay mb-2 w-64 max-w-[80vw] -translate-x-1/2 animate-fade-in"
        >
          <div className="rounded-md border border-line bg-surface px-4 py-3 text-sm shadow-pop">
            <div className="mb-2 truncate font-medium text-ink">{folder.name}</div>
            <dl className="space-y-1 text-xs">
              {rows.map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center gap-2">
                  <Icon className="h-3 w-3 shrink-0 text-ink-faint" aria-hidden />
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="tabular ml-auto text-ink-soft">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
