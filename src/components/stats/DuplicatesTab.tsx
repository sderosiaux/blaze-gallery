"use client";

import { useCallback, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button, Section, Skeleton, Stat, useToast } from "@/components/ui";
import { formatCount } from "@/lib/albums";
import type {
  DuplicateSelection,
  ExactDuplicatesPage,
} from "@/lib/exactDuplicateTypes";
import { restoreFromTrash } from "@/lib/trashClient";
import { formatNumber, formatSeconds, formatSize } from "./format";
import { TabError } from "./TabState";
import {
  useElapsed,
  useStatsResource,
  type Resource,
} from "./useStatsResource";
import DuplicateGroups from "./DuplicateGroups";
import DuplicateTrashDialog from "./DuplicateTrashDialog";

const cell = "border-t border-line pt-4";

export default function DuplicatesTab({
  active,
  onChange,
}: {
  active: boolean;
  onChange: () => void;
}) {
  const toast = useToast();
  const folders = useStatsResource<ExactDuplicatesPage>(
    "/api/stats/duplicate-folders",
    active,
  );
  const files = useStatsResource<ExactDuplicatesPage>(
    "/api/stats/duplicates",
    active,
  );
  const f =
    folders.state.status === "ready" ? folders.state.data.summary : undefined;
  const d =
    files.state.status === "ready" ? files.state.data.summary : undefined;
  const [selection, setSelection] = useState<DuplicateSelection | null>(null);
  const close = useCallback(() => {
    setSelection(null);
  }, []);
  const reloadFolders = folders.retry;
  const reloadFiles = files.retry;
  const reload = useCallback(() => {
    reloadFolders();
    reloadFiles();
    onChange();
  }, [reloadFolders, reloadFiles, onChange]);
  return (
    <div>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4 rounded-xl border border-line bg-surface-sunken p-4">
        <div className="max-w-3xl text-sm text-ink-muted">
          <p className="font-medium text-ink">
            Copies confirmées par leur contenu
          </p>
          <p className="mt-1">
            Photos, vidéos et autres fichiers, y compris les dossiers « Hors
            galerie ». Les fichiers identiques sont reconnus même après
            renommage, sans dépendre des piles.
          </p>
          <p className="mt-2 text-xs">
            Les fichiers système, les miniatures NAS et les fichiers de 10 Ko ou
            moins sont ignorés. Les fichiers sans empreinte fiable ne sont pas
            proposés à la suppression.
          </p>
        </div>
        <Button
          size="sm"
          icon={RotateCw}
          onClick={reload}
          disabled={
            folders.state.status === "loading" ||
            files.state.status === "loading"
          }
        >
          Actualiser
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 pt-8 lg:grid-cols-4">
        <PendingStat
          ready={!!f}
          label="Dossiers en trop"
          value={f && formatNumber(f.members - f.groups)}
          hint={
            f &&
            `${formatCount(f.groups, "groupe")} · ${formatCount(f.members, "dossier")}`
          }
        />
        <PendingStat
          ready={!!f}
          label="Copies de dossiers"
          value={f && formatSize(f.extra_bytes)}
          hint="Espace récupérable après vidage"
        />
        <PendingStat
          ready={!!d}
          label="Fichiers en trop"
          value={d && formatNumber(d.extra_files)}
          hint={
            d &&
            `${formatCount(d.groups, "groupe")} · ${formatCount(d.members, "fichier")}`
          }
        />
        <PendingStat
          ready={!!d}
          label="Copies de fichiers"
          value={d && formatSize(d.extra_bytes)}
          hint="Copies de dossiers comprises"
        />
      </div>
      <p className="mt-4 text-xs text-ink-muted">
        Ces deux estimations d’espace se recoupent : elles ne s’additionnent
        pas.
      </p>
      <Section
        title="Dossiers copiés"
        description="Mêmes noms et mêmes contenus pour les fichiers analysés. Choisissez le dossier dont les fichiers restent."
      >
        <Analysis
          resource={folders.state}
          onRetry={folders.retry}
          what="Comparaison du contenu des dossiers"
          failTitle="La comparaison des dossiers n’a pas abouti"
        >
          {(data) => (
            <DuplicateGroups
              key={folders.state.status === "ready" ? folders.state.tookMs : 0}
              kind="folders"
              data={data}
              onReview={setSelection}
            />
          )}
        </Analysis>
      </Section>
      <Section
        title="Fichiers identiques"
        description="Même contenu, quels que soient le nom et le dossier. Les copies déjà traitées dans les dossiers disparaissent aussi de cette liste."
      >
        <Analysis
          resource={files.state}
          onRetry={files.retry}
          what="Comparaison du contenu des fichiers"
          failTitle="La comparaison des fichiers n’a pas abouti"
        >
          {(data) => (
            <DuplicateGroups
              key={files.state.status === "ready" ? files.state.tookMs : 0}
              kind="files"
              data={data}
              onReview={setSelection}
            />
          )}
        </Analysis>
      </Section>
      {selection && (
        <DuplicateTrashDialog
          selection={selection}
          onClose={close}
          onChanged={(message) => {
            close();
            toast.show(message, "error");
            reload();
          }}
          onDone={({ count, lot }) => {
            close();
            reload();
            toast.show(
              `${formatCount(count, "fichier")} dans la corbeille`,
              "success",
              {
                action: {
                  label: "Annuler le lot",
                  onClick: () => {
                    restoreFromTrash({ lot })
                      .then(() => {
                        reload();
                        toast.show("Le lot a été restauré", "success");
                      })
                      .catch(() => {
                        toast.show("Le lot n’a pas pu être restauré", "error");
                      });
                  },
                },
              },
            );
          }}
        />
      )}
    </div>
  );
}

function PendingStat({
  ready,
  label,
  value,
  hint,
}: {
  ready: boolean;
  label: string;
  value?: string;
  hint?: string;
}) {
  if (!ready) {
    return (
      <div className={cell} aria-hidden>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-8 w-20" />
        <Skeleton className="mt-2 h-3 w-28" />
      </div>
    );
  }
  return (
    <Stat
      className={`${cell} animate-fade-in`}
      label={label}
      value={value}
      hint={hint}
    />
  );
}

function Analysis<T>({
  resource,
  onRetry,
  what,
  failTitle,
  children,
}: {
  resource: Resource<T>;
  onRetry: () => void;
  what: string;
  failTitle: string;
  children: (data: T) => React.ReactNode;
}) {
  const elapsed = useElapsed(
    resource.status === "loading" ? resource.startedAt : undefined,
  );
  if (resource.status === "error")
    return (
      <TabError title={failTitle} error={resource.error} onRetry={onRetry} />
    );
  if (resource.status === "ready") {
    return (
      <div className="animate-fade-in">
        {children(resource.data)}
        <p className="tabular mt-4 text-xs text-ink-faint">
          Analysé en {formatSeconds(resource.tookMs)}
        </p>
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite">
      <p className="tabular mb-4 flex items-center gap-2 text-sm text-ink-muted">
        <span
          aria-hidden
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
        />
        {what}… {elapsed > 0 ? `${elapsed} s` : ""}
      </p>
      <div aria-hidden className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-5 w-56 max-w-full" />
            <Skeleton className="mt-2 h-3 w-40" />
            <Skeleton className="mt-4 h-3.5 w-full" />
            <Skeleton className="mt-2 h-3.5 w-5/6" />
          </div>
        ))}
      </div>
    </div>
  );
}
