"use client";

import { useState, useEffect } from "react";
import { Photo } from "@/types";
import { Heart } from "lucide-react";
import PhotoViewer from "./PhotoViewer";
import PhotoSkeleton from "./PhotoSkeleton";
import PhotoTooltip from "./PhotoTooltip";

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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {photosState.map((photo) => (
            <PhotoTooltip key={photo.id} photo={photo}>
              <div
                className="group relative aspect-square bg-gray-100 rounded-lg overflow-hidden cursor-pointer"
                onClick={() => setSelectedPhoto(photo)}
              >
                <img
                  src={photo.thumbnail_url}
                  alt={photo.filename}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-opacity duration-200" />

                {/* Favorite heart icon - always visible if favorited, only on hover if not */}
                <button
                  onClick={(e) => toggleFavorite(photo, e)}
                  className={`absolute top-2 right-2 p-1 rounded-full bg-white bg-opacity-80 hover:bg-opacity-100 transition-all duration-200 ${
                    photo.is_favorite
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <Heart
                    className={`w-4 h-4 transition-colors ${
                      photo.is_favorite
                        ? "text-red-500 fill-current"
                        : "text-gray-600 hover:text-red-500"
                    }`}
                  />
                </button>
              </div>
            </PhotoTooltip>
          ))}
        </div>
      </div>

      {selectedPhoto && (
        <PhotoViewer
          photo={selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
        />
      )}
    </>
  );
}
