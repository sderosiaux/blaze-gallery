"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { CalendarDays, UsersRound } from "lucide-react";
import type { PersonSummary } from "@/lib/people";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import FaceThumb from "@/components/people/FaceThumb";
import {
  Badge,
  ButtonLink,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { LoadError } from "@/components/find/LoadError";
import { useUrlFilter } from "@/components/find/useUrlFilter";
import { filterSearch } from "@/lib/photoFilter";
import { asArray, readJsonObject } from "@/hooks/apiJson";
import { formatCount, formatNumber } from "@/lib/albums";

/** A person, and her page with the filter in effect (it follows from view to view). */
function PersonCard({
  person,
  search,
}: {
  person: PersonSummary;
  search: string;
}) {
  return (
    <li>
      <Link
        href={`/personnes/${String(person.id)}${search}`}
        className="group flex flex-col items-center gap-3 rounded-xl px-3 py-4 text-center transition-colors duration-150 hover:bg-surface-sunken"
      >
        <FaceThumb
          faceId={person.cover_face_id}
          eager
          className="h-28 w-28 rounded-full ring-1 ring-line transition-transform duration-200 ease-out-soft group-hover:scale-[1.03] sm:h-32 sm:w-32"
        />
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-ink">
            {person.name}
          </span>
          <span className="tabular mt-0.5 block text-sm text-ink-muted">
            {formatCount(person.photo_count, "photo")}
          </span>
        </span>
        {person.pending_count > 0 && (
          <Badge tone="info">
            {formatNumber(person.pending_count)} à trier
          </Badge>
        )}
      </Link>
    </li>
  );
}

function PeopleContent() {
  const [filter] = useUrlFilter();
  const search = filterSearch(filter);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [people, setPeople] = useState<PersonSummary[]>([]);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/people");
      const data = await readJsonObject(response);
      if (!response.ok || data.success !== true)
        throw new Error(`HTTP ${response.status}`);
      setPeople(asArray(data.people) as PersonSummary[]);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const header = <PageHeader title="Personnes" />;

  if (status === "error") {
    return (
      <>
        {header}
        <LoadError
          title="Les personnes n’ont pas pu être chargées"
          onRetry={() => void load()}
        />
      </>
    );
  }

  if (status === "loading") {
    return (
      <>
        {header}
        <ul
          aria-label="Chargement des personnes"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
        >
          {[0, 1, 2, 3].map((n) => (
            <li key={n} className="flex flex-col items-center gap-3 py-4">
              <Skeleton className="h-28 w-28 rounded-full sm:h-32 sm:w-32" />
              <Skeleton className="h-4 w-20" />
            </li>
          ))}
        </ul>
      </>
    );
  }

  if (people.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={UsersRound}
          title="Personne n’a encore de nom"
          body="Ouvrez une photo, appuyez sur P et touchez un visage pour lui donner un nom."
          action={
            <ButtonLink
              href="/timeline"
              variant="secondary"
              icon={CalendarDays}
            >
              Ouvrir la chronologie
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
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {people.map((person) => (
          <PersonCard key={person.id} person={person} search={search} />
        ))}
      </ul>
    </>
  );
}

export default function PeoplePage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <Suspense fallback={null}>
          <PeopleContent />
        </Suspense>
      </ProtectedRoute>
    </AppLayout>
  );
}
