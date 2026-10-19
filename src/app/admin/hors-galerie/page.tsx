"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ImageOff, Images, Library, RotateCw } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import {
  Button,
  ButtonLink,
  EmptyState,
  PageHeader,
  Skeleton,
  useToast,
} from "@/components/ui";
import { albumHref } from "@/components/photos/AlbumCard";
import { formatInstant } from "@/components/sharing/shareFormat";
import { formatCount } from "@/lib/albums";
import {
  fetchExcludedFolders,
  setFolderExcluded,
  type ExcludedFolderEntry,
} from "@/lib/excludedFolders";

export default function OutOfGalleryPage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <OutOfGallery />
      </ProtectedRoute>
    </AppLayout>
  );
}

function Header() {
  return (
    <PageHeader
      title="Hors galerie"
      meta="Des dossiers de stockage : toujours dans la Bibliothèque, absents de la Chronologie, de la Carte, des Couleurs, de Personnes et de la recherche par contenu."
    />
  );
}

function OutOfGallery() {
  const toast = useToast();
  const [folders, setFolders] = useState<ExcludedFolderEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setFolders(await fetchExcludedFolders());
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    document.title = "Hors galerie · Blaze Gallery";
    void load();
  }, [load]);

  // Gone from the list at once; back in place when the server refuses or on Annuler.
  const reintegrate = async (folder: ExcludedFolderEntry) => {
    setFolders((all) => all?.filter((f) => f.path !== folder.path) ?? all);
    const restore = () => {
      setFolders((all) =>
        all
          ? [...all.filter((f) => f.path !== folder.path), folder].sort(
              (a, b) => (a.path < b.path ? -1 : 1),
            )
          : all,
      );
    };
    try {
      await setFolderExcluded(folder.path, false);
      toast.show("Réintégré à la galerie", "success", {
        action: {
          label: "Annuler",
          onClick: () => {
            restore();
            setFolderExcluded(folder.path, true).catch(() => {
              void load();
              toast.show("Le changement n’a pas été enregistré", "error");
            });
          },
        },
      });
    } catch {
      restore();
      toast.show("Le changement n’a pas été enregistré", "error");
    }
  };

  if (failed && !folders) {
    return (
      <>
        <Header />
        <EmptyState
          icon={AlertCircle}
          title="La liste n'a pas pu être chargée"
          action={
            <Button
              variant="primary"
              icon={RotateCw}
              onClick={() => void load()}
            >
              Réessayer
            </Button>
          }
        />
      </>
    );
  }

  if (!folders) return <ListSkeleton />;

  if (folders.length === 0) {
    return (
      <>
        <Header />
        <EmptyState
          icon={ImageOff}
          title="Tous les dossiers font partie de la galerie"
          body="Pour en retirer un (livres, jeux, musique) : ouvrez-le dans la Bibliothèque, puis « ⋯ » et « Ce dossier n’est pas une galerie photo »."
          action={
            <ButtonLink href="/" variant="primary" icon={Library}>
              Ouvrir la Bibliothèque
            </ButtonLink>
          }
        />
      </>
    );
  }

  return (
    <>
      <Header />
      <ul className="divide-y divide-line border-y border-line">
        {folders.map((folder, i) => (
          <FolderRow
            key={folder.path}
            folder={folder}
            index={i}
            onReintegrate={(f) => void reintegrate(f)}
          />
        ))}
      </ul>
    </>
  );
}

function FolderRow({
  folder,
  index,
  onReintegrate,
}: {
  folder: ExcludedFolderEntry;
  index: number;
  onReintegrate: (folder: ExcludedFolderEntry) => void;
}) {
  const parts = folder.path.split("/");
  const name = parts[parts.length - 1] ?? folder.path;
  const parent = parts.slice(0, -1).join(" / ");
  return (
    <li
      className="flex animate-rise-in flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-6"
      style={{ animationDelay: `${Math.min(index, 10) * 25}ms` }}
    >
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-base font-semibold leading-snug text-ink">
          <Link
            href={albumHref(folder.path)}
            className="underline-offset-4 hover:underline"
            title={folder.path}
          >
            {name}
          </Link>
        </h2>
        {parent && <p className="truncate text-xs text-ink-muted">{parent}</p>}
      </div>
      <p className="tabular text-sm text-ink-muted sm:w-64 sm:text-right">
        {formatCount(folder.photo_count, "photo")}
        {folder.created_at && (
          <> · depuis le {formatInstant(folder.created_at)}</>
        )}
      </p>
      <div className="-ml-3 sm:ml-0">
        <Button
          variant="ghost"
          size="sm"
          icon={Images}
          onClick={() => {
            onReintegrate(folder);
          }}
        >
          Réintégrer à la galerie
        </Button>
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <>
      <Header />
      <ul
        role="status"
        aria-label="Chargement"
        className="divide-y divide-line border-y border-line"
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="flex items-center gap-6 py-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="hidden h-4 w-48 sm:block" />
            <Skeleton className="h-8 w-44 rounded-full" />
          </li>
        ))}
      </ul>
    </>
  );
}
