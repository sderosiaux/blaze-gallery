"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Folder, Photo } from "@/types";
import FolderBrowser from "@/components/FolderBrowser";
import PhotoGrid from "@/components/PhotoGrid";
import AppLayout from "@/components/AppLayout";

interface BreadcrumbItem {
  name: string;
  path: string;
}

export default function HomePage() {
  const router = useRouter();
  const [currentFolder, setCurrentFolder] = useState<Folder | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [bucketName, setBucketName] = useState("Root");
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { name: "Root", path: "" },
  ]);

  useEffect(() => {
    loadBucketName();
    loadRootFolders();
  }, []);

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

  const loadRootFolders = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/folders");
      const data = await response.json();
      setCurrentFolder(null);
      setFolders(data.folders || []);
      setPhotos(data.photos || []);
      setBreadcrumbs([{ name: bucketName, path: "" }]);
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
