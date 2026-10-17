"use client";

import { Suspense } from "react";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import LibraryHome from "@/components/library/LibraryHome";
import { PageSkeleton } from "@/components/ui";

export default function HomePage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        {/* useSearchParams (the open photo) needs a boundary. */}
        <Suspense fallback={<PageSkeleton />}>
          <LibraryHome />
        </Suspense>
      </ProtectedRoute>
    </AppLayout>
  );
}
