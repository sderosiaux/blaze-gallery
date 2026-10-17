"use client";

import { Suspense } from "react";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AlbumView from "@/components/library/AlbumView";
import LibraryHome from "@/components/library/LibraryHome";
import { pathFromSegments } from "@/components/library/albumData";
import { PageSkeleton } from "@/components/ui";

interface FolderPageProps {
  params: { path?: string[] };
}

export default function FolderPage({ params }: FolderPageProps) {
  const path = pathFromSegments(params.path);
  return (
    <AppLayout>
      <ProtectedRoute>
        {/* useSearchParams (the open photo) needs a boundary. */}
        <Suspense fallback={<PageSkeleton />}>
          {/* Keyed so moving between albums starts each one from its own state. */}
          {path ? <AlbumView key={path} path={path} /> : <LibraryHome />}
        </Suspense>
      </ProtectedRoute>
    </AppLayout>
  );
}
