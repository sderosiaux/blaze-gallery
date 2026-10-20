"use client";

import { Suspense } from "react";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { PageSkeleton } from "@/components/ui";
import ColorBands from "@/components/colors/ColorBands";
import ColorGrid from "@/components/colors/ColorGrid";
import { useFilterVocabulary } from "@/components/find/useFilterVocabulary";
import { useUrlFilter } from "@/components/find/useUrlFilter";
import { hasColorFilter } from "@/lib/colors";
import { understandQuery } from "@/lib/searchQuery";

/**
 * The nuancier, or with a color or a tone (`?color=`, `?tone=`, or said
 * by the filter's words, « Suzie en bleu ») every photo of it; the rest of
 * the filter narrows either.
 */
function ColorsContent() {
  const [filter, setFilter] = useUrlFilter();
  const vocabulary = useFilterVocabulary();
  const said = understandQuery(
    filter.q,
    vocabulary?.people ?? [],
    vocabulary?.tags ?? [],
  ).colors;
  const colors = {
    color: filter.colors.color ?? said.color,
    tone: filter.colors.tone ?? said.tone,
  };
  return hasColorFilter(colors) ? (
    <ColorGrid colors={colors} filter={filter} onFilterChange={setFilter} />
  ) : (
    <ColorBands filter={filter} onFilterChange={setFilter} />
  );
}

export default function ColorsPage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <Suspense fallback={<PageSkeleton />}>
          <ColorsContent />
        </Suspense>
      </ProtectedRoute>
    </AppLayout>
  );
}
