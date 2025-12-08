"use client";

import { useState, useEffect } from "react";
import { Photo } from "@/types";
import { Expand, Minimize2 } from "lucide-react";
import PhotoViewer from "./PhotoViewer";
import PhotoSkeleton from "./PhotoSkeleton";
import PhotoItem from "./PhotoItem";
import { useLayout } from "@/contexts/LayoutContext";

interface PhotoGridProps {
  photos: Photo[];
  loading?: boolean;
  selectedPhotoId?: string | null;
  onPhotoUrlChange?: (photoId: string | null) => void;
  isSharedView?: boolean;
  shareToken?: string;
  allowDownload?: boolean;
  sessionToken?: string;
}

export default function PhotoGrid({
  photos,
  loading = false,
  selectedPhotoId,
  onPhotoUrlChange,
  isSharedView = false,
  shareToken,
  allowDownload = true,
  sessionToken,
}: PhotoGridProps) {
  const { isFullWidth, setIsFullWidth } = useLayout();
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [photosState, setPhotosState] = useState<Photo[]>(photos);

  // Update photos state when props change
  useEffect(() => {
    setPhotosState(photos);
  }, [photos]);

  // Keyboard navigation for gallery expand/compress
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if no photo viewer is open and no modal is visible
      const hasModal = document.querySelector(
        '[role="dialog"], .fixed.inset-0.z-50, .fixed.inset-0.bg-black',
      );
      const isInputFocused =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;

      if (
        !selectedPhoto &&
        !hasModal &&
        !isInputFocused &&
        (e.key === "e" || e.key === "E")
      ) {
        e.preventDefault();
        setIsFullWidth(!isFullWidth);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedPhoto, isFullWidth]);

  // Handle initial photo selection from URL params
  useEffect(() => {
    if (selectedPhotoId && photos.length > 0) {
      const photo = photos.find((p) => p.id.toString() === selectedPhotoId);
      if (photo) {
        setSelectedPhoto(photo);
      }
    }
  }, [selectedPhotoId, photos]);

  // Handle photo selection and URL updates
  const handlePhotoSelect = (photo: Photo) => {
    setSelectedPhoto(photo);
    onPhotoUrlChange?.(photo.id.toString());
  };

  // Handle photo close and URL updates
  const handlePhotoClose = () => {
    setSelectedPhoto(null);
    onPhotoUrlChange?.(null);
  };

  const toggleFavorite = async (photo: Photo, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent opening the photo viewer

    // Don't allow favorite toggling in shared view
    if (isSharedView) {
      return;
    }

    try {
      const response = await fetch(`/api/photos/${photo.id}/favorite`, {
        method: "POST",
      });

      const data = await response.json();

      if (data.success) {
        // Update local state
        setPhotosState((prevPhotos) =>
          prevPhotos.map((p) =>
            p.id === photo.id ? { ...p, is_favorite: data.is_favorite } : p,
          ),
        );
      }
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    }
  };

  // Show skeletons while loading
  if (loading) {
    return (
      <div
        className={`bg-white shadow ${
          isFullWidth
            ? "w-screen relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] px-4 py-6"
            : "rounded-lg p-6"
        }`}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium text-gray-900">
            Loading photos...
          </h2>
          <button
            onClick={() => setIsFullWidth(!isFullWidth)}
            className={`p-2 hover:bg-gray-100 rounded-lg transition-colors ${
              isFullWidth
                ? "bg-gray-100 text-blue-600"
                : "text-gray-600 hover:text-blue-600"
            }`}
            title={isFullWidth ? "Compress gallery (E)" : "Expand gallery (E)"}
          >
            {isFullWidth ? (
              <Minimize2 className="w-5 h-5" />
            ) : (
              <Expand className="w-5 h-5" />
            )}
          </button>
        </div>
        <div
          className={`photo-mosaic ${
            isFullWidth
              ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12"
              : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
          }`}
        >
          {Array.from({ length: 12 }).map((_, index) => (
            <PhotoSkeleton key={index} />
          ))}
        </div>
      </div>
    );
  }

  // Don't render anything if there are no photos - let the parent handle empty state
  if (photos.length === 0) {
    return null;
  }

  return (
    <>
      <div
        className={`bg-white shadow ${
          isFullWidth
            ? "w-screen relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] px-4 py-6"
            : "rounded-lg p-6"
        }`}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium text-gray-900">
            Media ({photos.length})
          </h2>
          <button
            onClick={() => setIsFullWidth(!isFullWidth)}
            className={`p-2 hover:bg-gray-100 rounded-lg transition-colors ${
              isFullWidth
                ? "bg-gray-100 text-blue-600"
                : "text-gray-600 hover:text-blue-600"
            }`}
            title={isFullWidth ? "Compress gallery (E)" : "Expand gallery (E)"}
          >
            {isFullWidth ? (
              <Minimize2 className="w-5 h-5" />
            ) : (
              <Expand className="w-5 h-5" />
            )}
          </button>
        </div>
        <div
          className={`photo-mosaic ${
            isFullWidth
              ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12"
              : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
          }`}
        >
          {photosState.map((photo, index) => (
            <PhotoItem
              key={photo.id}
              photo={photo}
              onPhotoClick={handlePhotoSelect}
              onToggleFavorite={toggleFavorite}
              priority={index < 20 ? 10 - Math.floor(index / 2) : 0} // First 20 images get higher priority
              isSharedView={isSharedView}
              shareToken={shareToken}
              sessionToken={sessionToken}
            />
          ))}
        </div>
      </div>

      {selectedPhoto && (
        <PhotoViewer
          photo={selectedPhoto}
          photos={photosState}
          onClose={handlePhotoClose}
          onFavoriteToggle={
            !isSharedView
              ? (updatedPhoto) => {
                  // Update the photo in the local state
                  setPhotosState((prevPhotos) =>
                    prevPhotos.map((p) =>
                      p.id === updatedPhoto.id ? updatedPhoto : p,
                    ),
                  );
                  // DON'T update selectedPhoto here - it causes image reload in PhotoViewer
                  // The PhotoViewer manages its own favorite state separately to prevent this issue
                }
              : undefined
          }
          onPhotoChange={(newPhoto) => {
            setSelectedPhoto(newPhoto);
            onPhotoUrlChange?.(newPhoto.id.toString());
          }}
          isSharedView={isSharedView}
          shareToken={shareToken}
          allowDownload={allowDownload}
          sessionToken={sessionToken}
        />
      )}
    </>
  );
}
