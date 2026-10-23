"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Layers, Trash2 } from "lucide-react";
import { albumHref } from "@/components/photos/AlbumCard";
import { Badge, Button, EmptyState, Switch } from "@/components/ui";
import { readJsonObject } from "@/hooks/apiJson";
import { formatCount } from "@/lib/albums";
import { cn } from "@/lib/cn";
import type {
  DuplicateKind,
  DuplicateSelection,
  ExactDuplicateGroup,
  ExactDuplicatesPage,
} from "@/lib/exactDuplicateTypes";
import { formatSize } from "./format";

export default function DuplicateGroups({
  kind,
  data,
  onReview,
}: {
  kind: DuplicateKind;
  data: ExactDuplicatesPage;
  onReview: (selection: DuplicateSelection) => void;
}) {
  const [pages, setPages] = useState<ExactDuplicatesPage[]>([]);
  const [visible, setVisible] = useState(6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keep, setKeep] = useState<ReadonlyMap<string, number>>(new Map());
  const [skip, setSkip] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const groups = [
    ...new Map(
      [data, ...pages].flatMap((p) => p.groups).map((g) => [g.key, g]),
    ).values(),
  ];
  const next = (pages[pages.length - 1] ?? data).next;
  const more = async () => {
    if (visible < groups.length) {
      setVisible((n) => n + 8);
      return;
    }
    if (!next || loading) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      const params = new URLSearchParams({
        key: next.key,
        bytes: String(next.bytes),
      });
      const response = await fetch(
        `/api/stats/${kind === "files" ? "duplicates" : "duplicate-folders"}?${params.toString()}`,
        { signal: ctrl.signal, cache: "no-store" },
      );
      const body = await readJsonObject(response);
      if (!response.ok || body.success !== true) throw new Error("page");
      setPages((old) => [...old, body.data as ExactDuplicatesPage]);
      setVisible((n) => n + 8);
    } catch {
      if (!ctrl.signal.aborted) setError("La suite n’a pas pu être chargée.");
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  };
  const review = (group?: ExactDuplicateGroup) => {
    onReview({
      kind,
      group: group?.key ?? "all",
      keep: group
        ? [keep.get(group.key) ?? group.members[0]?.id ?? 0]
        : [...keep].filter(([key]) => !skip.has(key)).map(([, id]) => id),
      skip: group ? [] : [...skip],
    });
  };
  if (data.summary.groups === 0)
    return (
      <EmptyState
        icon={CheckCircle2}
        title={
          kind === "files"
            ? "Aucune copie de fichier confirmée"
            : "Aucun dossier copié confirmé"
        }
        className="py-8"
      />
    );
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          Choisissez l’exemplaire à garder. Les autres copies iront à la
          corbeille.
        </p>
        <Button
          icon={Layers}
          onClick={() => {
            review();
          }}
        >
          Tout traiter…
        </Button>
      </div>
      <ol className="grid items-start gap-4 xl:grid-cols-2">
        {groups.slice(0, visible).map((g) => {
          const kept = keep.get(g.key) ?? g.members[0]?.id;
          const skipped = skip.has(g.key);
          const open = expanded.has(g.key);
          const locations = open
            ? g.members
            : g.members.filter(
                (member, index) => index < 2 || member.id === kept,
              );
          return (
            <li
              key={g.key}
              className={cn(
                "min-w-0 rounded-xl border border-line p-4 sm:p-5",
                skipped && "bg-surface-sunken",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words font-display text-lg font-semibold text-ink">
                    {g.members[0]?.name}
                  </h3>
                  <p className="mt-1 text-sm text-ink-muted">
                    {kind === "folders" &&
                      `${formatCount(g.files_per_member, "fichier")} par dossier · `}
                    {formatSize(g.extra_bytes)} de copies en trop
                  </p>
                </div>
                <Badge tone="neutral" className="shrink-0">
                  {formatCount(
                    g.count,
                    kind === "folders" ? "dossier" : "exemplaire",
                  )}
                </Badge>
              </div>
              <ul className="my-4 space-y-2">
                {locations.map((member) => {
                  const fullPath =
                    kind === "files"
                      ? `${member.path}/${member.name}`
                      : member.path;
                  return (
                    <li
                      key={member.id}
                      className="flex items-start gap-3 rounded-md border border-line p-2.5"
                    >
                      <label className="touch-target flex shrink-0 cursor-pointer items-center gap-1.5 text-sm text-ink">
                        <input
                          type="radio"
                          name={`keep-${kind}-${g.key}`}
                          checked={kept === member.id}
                          disabled={skipped}
                          aria-label={`Garder ${fullPath}`}
                          className="accent-ink"
                          onChange={() => {
                            setKeep((old) =>
                              new Map(old).set(g.key, member.id),
                            );
                          }}
                        />
                        Garder
                      </label>
                      <div className="min-w-0 text-sm">
                        <Link
                          href={
                            kind === "files"
                              ? `${albumHref(member.path)}?photo=${member.id}`
                              : albumHref(member.path)
                          }
                          title={fullPath}
                          className="break-words text-ink-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
                        >
                          {fullPath}
                        </Link>
                        {member.outside_gallery && (
                          <span className="mt-1 block text-xs text-ink-faint">
                            Hors galerie
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {(open || locations.length < g.members.length) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mb-3"
                  onClick={() => {
                    setExpanded((old) => {
                      const changed = new Set(old);
                      if (open) changed.delete(g.key);
                      else changed.add(g.key);
                      return changed;
                    });
                  }}
                >
                  {open
                    ? "Réduire les emplacements"
                    : `Voir ${formatCount(g.members.length - locations.length, "autre emplacement", "autres emplacements")}`}
                </Button>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                <Switch
                  id={`leave-${kind}-${g.key}`}
                  checked={skipped}
                  onChange={(value) => {
                    setSkip((old) => {
                      const changed = new Set(old);
                      if (value) changed.add(g.key);
                      else changed.delete(g.key);
                      return changed;
                    });
                  }}
                  label="Laisser ce groupe"
                />
                <Button
                  size="sm"
                  icon={Trash2}
                  disabled={skipped}
                  onClick={() => {
                    review(g);
                  }}
                >
                  {formatCount(g.extra_files, "fichier")} à la corbeille…
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {Math.min(visible, groups.length)} sur{" "}
          {formatCount(data.summary.groups, "groupe")} · du plus volumineux au
          plus petit
        </p>
        {(visible < groups.length || next) && (
          <Button loading={loading} onClick={() => void more()}>
            Afficher la suite
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
