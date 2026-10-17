"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { albumHref } from "@/components/photos/AlbumCard";
import { cn } from "@/lib/cn";
import { albumTitle } from "./albumData";

interface Crumb {
  label: string;
  href: string;
}

function ancestorsOf(path: string): Crumb[] {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, i) => {
    const p = parts.slice(0, i + 1).join("/");
    return { label: albumTitle(p), href: albumHref(p) };
  });
}

function Separator() {
  return <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-faint" />;
}

const linkClass =
  "block max-w-[9rem] truncate rounded-sm transition-colors duration-150 hover:text-ink sm:max-w-[14rem]";

/**
 * Library and the ancestors of the open album; the album itself is the page
 * title. Deep chains keep the first and the last two, the middle folds into
 * an ellipsis that unfolds on click. On phones only the parent stays.
 */
export default function AlbumBreadcrumb({ path }: { path: string }) {
  const [expanded, setExpanded] = useState(false);
  const ancestors = ancestorsOf(path);
  const crumbs: Crumb[] = [{ label: "Library", href: "/" }, ...ancestors];
  const fold = !expanded && crumbs.length > 4;
  const hidden = fold ? crumbs.slice(2, -2) : [];
  const parentIndex = crumbs.length - 1;

  return (
    <nav aria-label="Breadcrumb" className="animate-fade-in pt-6 sm:pt-8">
      <ol className={cn("flex min-w-0 items-center gap-1.5 text-sm text-ink-muted", expanded && "flex-wrap")}>
        {crumbs.map((crumb, i) => {
          if (fold && i >= 2 && i < crumbs.length - 2) {
            if (i !== 2) return null;
            return (
              <li key="fold" className="hidden items-center gap-1.5 sm:flex">
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  aria-label={`Show ${hidden.length} more: ${hidden.map((c) => c.label).join(", ")}`}
                  title={hidden.map((c) => c.label).join(" / ")}
                  className="rounded-sm px-1 transition-colors duration-150 hover:text-ink"
                >
                  …
                </button>
                <Separator />
              </li>
            );
          }
          // Phones keep Library and the parent; the rest collapses into "…".
          const phoneHidden = i > 0 && i < parentIndex;
          return (
            <li key={crumb.href} className={cn("min-w-0 items-center gap-1.5", phoneHidden ? "hidden sm:flex" : "flex")}>
              <Link href={crumb.href} className={linkClass} title={crumb.label}>
                {crumb.label}
              </Link>
              {i < parentIndex && <Separator />}
              {i === 0 && parentIndex > 1 && (
                <span aria-hidden className="flex items-center gap-1.5 sm:hidden">
                  …
                  <Separator />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
