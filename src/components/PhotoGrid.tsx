"use client";

import { useState, useEffect } from "react";
import { Photo } from "@/types";
import PhotoViewer from "./PhotoViewer";
import PhotoSkeleton from "./PhotoSkeleton";
import PhotoItem from "./PhotoItem";

interface PhotoGridProps {
  photos: Photo[];
  loading?: boolean;
}

export default function PhotoGrid({ photos, loading = false }: PhotoGridProps) {
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
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">
          Loading photos...
        </h2>
        <div className="photo-mosaic grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
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
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">
          Photos ({photos.length})
        </h2>
        <div className="photo-mosaic grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {photosState.map((photo) => (
            <PhotoItem
              key={photo.id}
              photo={photo}
              onPhotoClick={setSelectedPhoto}
              onToggleFavorite={toggleFavorite}
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
