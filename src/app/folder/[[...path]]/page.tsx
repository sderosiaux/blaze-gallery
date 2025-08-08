"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Folder, Photo } from "@/types";
import FolderBrowser from "@/components/FolderBrowser";
import PhotoGrid from "@/components/PhotoGrid";
import AppLayout from "@/components/AppLayout";

interface BreadcrumbItem {
  name: string;
  path: string;
}

interface FolderPageProps {
  params: {
    path?: string[];
  };
}

// Note: generateMetadata would need to be in a server component
// For now, we'll handle page titles dynamically in the client component

export default function FolderPage({ params }: FolderPageProps) {
  const router = useRouter();
  const [currentFolder, setCurrentFolder] = useState<Folder | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { name: "Root", path: "" },
  ]);

  // Get the current folder path from URL params
  const currentPath = params.path ? params.path.join("/") : "";

  useEffect(() => {
    if (currentPath === "") {
      loadRootFolders();
    } else {
      loadFolder(currentPath);
    }
  }, [currentPath]);

  // Update page title dynamically
  useEffect(() => {
    const folderName = currentPath ? currentPath.split("/").pop() : "Root";
    document.title = `${folderName} - Blaze Gallery`;
  }, [currentPath]);

  const loadRootFolders = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/folders");
      const data = await response.json();
      setCurrentFolder(null);
      setFolders(data.folders || []);
      setPhotos(data.photos || []);
      setBreadcrumbs([{ name: "Root", path: "" }]);
    } catch (error) {
      console.error("[CLIENT] Failed to load folders:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadFolder = async (folderPath: string) => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/folders/${encodeURIComponent(folderPath)}`,
      );
      const data = await response.json();

      if (!response.ok) {
        console.error("[CLIENT] Folder not found:", folderPath);
        // Redirect to root if folder not found
        router.push("/");
        return;
      }

      setCurrentFolder(data.folder);
      setFolders(data.subfolders || []);
      setPhotos(data.photos || []);

      // Build breadcrumbs from the folder path
      const pathParts = folderPath.split("/").filter((part) => part);
      const newBreadcrumbs: BreadcrumbItem[] = [{ name: "Root", path: "" }];

      let currentPath = "";
      for (const part of pathParts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        newBreadcrumbs.push({ name: part, path: currentPath });
      }

      setBreadcrumbs(newBreadcrumbs);
    } catch (error) {
      console.error("[CLIENT] Failed to load folder:", error);
      // Redirect to root on error
      router.push("/");
    } finally {
      setLoading(false);
    }
  };

  const navigateToFolder = (folderPath: string) => {
    if (folderPath === "") {
      router.push("/");
    } else {
      router.push(`/folder/${folderPath}`);
    }
  };

  const navigateToBreadcrumb = (breadcrumbPath: string) => {
    if (breadcrumbPath === "") {
      router.push("/");
    } else {
      router.push(`/folder/${breadcrumbPath}`);
    }
  };

  return (
    <AppLayout>
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
          <PhotoGrid photos={photos} loading={loading} />
        </div>
      )}
    </AppLayout>
  );
}
