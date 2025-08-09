"use client";

import { useState, useEffect } from "react";
import { Photo } from "@/types";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import PhotoViewer from "./PhotoViewer";
import PhotoSkeleton from "./PhotoSkeleton";
import PhotoItem from "./PhotoItem";
import { useLayout } from "@/contexts/LayoutContext";

interface PhotoGridProps {
  photos: Photo[];
  loading?: boolean;
}

export default function PhotoGrid({ photos, loading = false }: PhotoGridProps) {
  const { isFullWidth, setIsFullWidth } = useLayout();
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [photosState, setPhotosState] = useState<Photo[]>(photos);

  // Update photos state when props change
  useEffect(() => {
    setPhotosState(photos);
  }, [photos]);

  const toggleFavorite = async (photo: Photo, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent opening the photo viewer

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
      <div className={`bg-white shadow ${
        isFullWidth 
          ? "w-screen relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] px-4 py-6" 
          : "rounded-lg p-6"
      }`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium text-gray-900">
            Loading photos...
          </h2>
          <button
            onClick={() => setIsFullWidth(!isFullWidth)}
            className="p-2 text-gray-600 hover:text-blue-600 hover:bg-gray-50 rounded-lg transition-colors"
            title={isFullWidth ? "Compress gallery" : "Expand gallery"}
          >
            {isFullWidth ? (
              <ChevronsLeft className="w-5 h-5" />
            ) : (
              <ChevronsRight className="w-5 h-5" />
            )}
          </button>
        </div>
        <div className={`photo-mosaic ${
          isFullWidth 
            ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12"
            : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
        }`}>
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
      <div className={`bg-white shadow ${
        isFullWidth 
          ? "w-screen relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] px-4 py-6" 
          : "rounded-lg p-6"
      }`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium text-gray-900">
            Photos ({photos.length})
          </h2>
          <button
            onClick={() => setIsFullWidth(!isFullWidth)}
            className="p-2 text-gray-600 hover:text-blue-600 hover:bg-gray-50 rounded-lg transition-colors"
            title={isFullWidth ? "Compress gallery" : "Expand gallery"}
          >
            {isFullWidth ? (
              <ChevronsLeft className="w-5 h-5" />
            ) : (
              <ChevronsRight className="w-5 h-5" />
            )}
          </button>
        </div>
        <div className={`photo-mosaic ${
          isFullWidth 
            ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12"
            : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
        }`}>
          {photosState.map((photo, index) => (
            <PhotoItem
              key={photo.id}
              photo={photo}
              onPhotoClick={setSelectedPhoto}
              onToggleFavorite={toggleFavorite}
              priority={index < 20 ? 10 - Math.floor(index / 2) : 0} // First 20 images get higher priority
            />
          ))}
        </div>
      </div>

      {selectedPhoto && (
        <PhotoViewer
          photo={selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
          onFavoriteToggle={(updatedPhoto) => {
            // Update the photo in the local state
            setPhotosState((prevPhotos) =>
              prevPhotos.map((p) =>
                p.id === updatedPhoto.id ? updatedPhoto : p
              )
            );
            // Update the selected photo as well
            setSelectedPhoto(updatedPhoto);
          }}
        />
      )}
    </>
  );
}
