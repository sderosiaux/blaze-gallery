"use client";

import { Suspense } from "react";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { PageSkeleton } from "@/components/ui";
import ColorBands from "@/components/colors/ColorBands";
import ColorGrid from "@/components/colors/ColorGrid";
import { useColorFilterParam } from "@/components/find/useColorFilterParam";
import { hasColorFilter } from "@/lib/colors";

/** The nuancier, or with `?color=` / `?tone=` every photo of that color. */
function ColorsContent() {
  const [colors, setColors] = useColorFilterParam();
  return hasColorFilter(colors) ? (
    <ColorGrid colors={colors} onColorsChange={setColors} />
  ) : (
    <ColorBands />
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
