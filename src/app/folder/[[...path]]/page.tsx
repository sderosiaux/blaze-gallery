"use client";

import { useEffect, useState, Suspense } from "react";
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

function FolderContent({ params }: FolderPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentFolder, setCurrentFolder] = useState<Folder | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [bucketName, setBucketName] = useState("");
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);

  // Get the current folder path from URL params
  const currentPath = params.path ? params.path.join("/") : "";
  
  // Get selected photo ID from URL search params
  const selectedPhotoId = searchParams.get("photo");

  // Handle photo URL changes
  const handlePhotoUrlChange = (photoId: string | null) => {
    const url = new URL(window.location.href);
    if (photoId) {
      url.searchParams.set("photo", photoId);
    } else {
      url.searchParams.delete("photo");
    }
    router.push(url.pathname + url.search, { scroll: false });
  };

  useEffect(() => {
    loadBucketName();
    if (currentPath === "") {
      loadRootFolders();
    } else {
      loadFolder(currentPath);
    }
  }, [currentPath]);

  const loadBucketName = async () => {
    try {
      const response = await fetch("/api/bucket");
      const data = await response.json();
      if (data.success && data.bucket) {
        setBucketName(data.bucket);
      }
    } catch (error) {
      console.error("[CLIENT] Failed to load bucket name:", error);
    }
  };

  // Rebuild breadcrumbs when bucket name loads (regardless of when it loads)
  useEffect(() => {
    if (!bucketName) return; // Wait until we have the bucket name
    
    if (currentPath === "") {
      // We're at root
      setBreadcrumbs([{ name: bucketName, path: "" }]);
    } else {
      // We're in a folder - rebuild breadcrumbs with bucket name at root
      const pathParts = currentPath.split("/").filter((part) => part);
      const newBreadcrumbs: BreadcrumbItem[] = [{ name: bucketName, path: "" }];
      
      let buildPath = "";
      for (const part of pathParts) {
        buildPath = buildPath ? `${buildPath}/${part}` : part;
        newBreadcrumbs.push({ name: part, path: buildPath });
      }
      
      setBreadcrumbs(newBreadcrumbs);
    }
  }, [bucketName, currentPath]); // Trigger when bucket loads OR when path changes

  // Update page title dynamically
  useEffect(() => {
    const folderName = currentPath ? currentPath.split("/").pop() : (bucketName || "Gallery");
    document.title = `${folderName} - Blaze Gallery`;
  }, [currentPath, bucketName]);

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
      
      // Breadcrumbs are now handled by the useEffect that watches bucketName and currentPath
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
          <PhotoGrid 
            photos={photos} 
            loading={loading}
            selectedPhotoId={selectedPhotoId}
            onPhotoUrlChange={handlePhotoUrlChange}
          />
        </div>
      )}
    </AppLayout>
  );
}

export default function FolderPage({ params }: FolderPageProps) {
  return (
    <Suspense
      fallback={
        <AppLayout title="Loading...">
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        </AppLayout>
      }
    >
      <FolderContent params={params} />
    </Suspense>
  );
}
