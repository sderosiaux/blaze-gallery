"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Folder, Photo } from "@/types";
import FolderBrowser from "@/components/FolderBrowser";
import PhotoGrid from "@/components/PhotoGrid";
import RandomPhotosTeaser from "@/components/RandomPhotosTeaser";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/components/auth/AuthProvider";
import { BreadcrumbItem, buildBreadcrumbs } from "@/lib/navigation";

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [currentFolder, setCurrentFolder] = useState<Folder | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [bucketName, setBucketName] = useState("");
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);

  // Get photo ID from URL params
  const selectedPhotoId = searchParams?.get("photo");

  useEffect(() => {
    // Only load data if authenticated
    if (isAuthenticated && !authLoading) {
      loadBucketName();
      loadRootFolders();
    } else if (!authLoading && !isAuthenticated) {
      // Not authenticated and not loading - reset loading state
      setLoading(false);
    }
  }, [isAuthenticated, authLoading]);

  const loadBucketName = async () => {
    try {
      const response = await fetch("/api/bucket");
      const data = await response.json();
      if (data.success && data.bucket) {
        setBucketName(data.bucket);
        setBreadcrumbs(buildBreadcrumbs(data.bucket, ""));
      }
    } catch (error) {
      console.error("[CLIENT] Failed to load bucket name:", error);
    }
  };

  const loadRootFolders = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/folders");
      const data = await response.json();
      setCurrentFolder(null);
      setFolders(data.folders || []);
      setPhotos(data.photos || []);
      // Breadcrumb is set by loadBucketName
    } catch (error) {
      console.error("[CLIENT] Failed to load folders:", error);
    } finally {
      setLoading(false);
    }
  };

  const navigateToFolder = (folderPath: string) => {
    router.push(`/folder/${folderPath}`);
  };

  const navigateToBreadcrumb = (breadcrumbPath: string) => {
    if (breadcrumbPath === "") {
      router.push("/");
    } else {
      router.push(`/folder/${breadcrumbPath}`);
    }
  };

  // Handle photo URL changes
  const handlePhotoUrlChange = (photoId: string | null) => {
    const currentUrl = new URL(window.location.href);
    if (photoId) {
      currentUrl.searchParams.set("photo", photoId);
    } else {
      currentUrl.searchParams.delete("photo");
    }
    router.replace(currentUrl.pathname + currentUrl.search);
  };

  // Check if we should show random photos teaser
  // Show it when we're at root level with folders but no photos
  const showRandomPhotosTeaser =
    !loading && folders.length > 0 && photos.length === 0;

  return (
    <AppLayout>
      <ProtectedRoute>
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          <div className="space-y-6">
            <FolderBrowser
              currentFolder={currentFolder}
              folders={folders}
              breadcrumbs={breadcrumbs}
              onFolderSelect={navigateToFolder}
              onBreadcrumbClick={navigateToBreadcrumb}
            />

            {/* Show photos in root if any exist */}
            <PhotoGrid
              photos={photos}
              loading={loading}
              selectedPhotoId={selectedPhotoId}
              onPhotoUrlChange={handlePhotoUrlChange}
            />

            {/* Show random photos teaser when at root with folders but no photos */}
            {showRandomPhotosTeaser && (
              <RandomPhotosTeaser
                selectedPhotoId={selectedPhotoId}
                onPhotoUrlChange={handlePhotoUrlChange}
              />
            )}
          </div>
        )}
      </ProtectedRoute>
    </AppLayout>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <AppLayout>
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        </AppLayout>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
