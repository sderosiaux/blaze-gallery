"use client";

import { useEffect, useState } from "react";
import { Photo } from "@/types";
import { Sparkles, RefreshCw } from "lucide-react";
import PhotoItem from "./PhotoItem";
import PhotoSkeleton from "./PhotoSkeleton";
import PhotoViewer from "./PhotoViewer";

interface RandomPhotosTeaserProps {
  onPhotoUrlChange?: (photoId: string | null) => void;
  selectedPhotoId?: string | null;
}

export default function RandomPhotosTeaser({ onPhotoUrlChange, selectedPhotoId }: RandomPhotosTeaserProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);

  const loadRandomPhotos = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/photos/random?limit=32");
      const data = await response.json();
      
      if (data.success) {
        setPhotos(data.photos);
      } else {
        console.error("Failed to load random photos:", data.error);
      }
    } catch (error) {
      console.error("Error loading random photos:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRandomPhotos();
  }, []);

  // Handle initial photo selection from URL params
  useEffect(() => {
    if (selectedPhotoId && photos.length > 0) {
      const photo = photos.find(p => p.id.toString() === selectedPhotoId);
      if (photo) {
        setSelectedPhoto(photo);
      }
    }
  }, [selectedPhotoId, photos]);

  const handlePhotoSelect = (photo: Photo) => {
    setSelectedPhoto(photo);
    onPhotoUrlChange?.(photo.id.toString());
  };

  const handlePhotoClose = () => {
    setSelectedPhoto(null);
    onPhotoUrlChange?.(null);
  };

  const toggleFavorite = async (photo: Photo, event: React.MouseEvent) => {
    event.stopPropagation();

    try {
      const response = await fetch(`/api/photos/${photo.id}/favorite`, {
        method: "POST",
      });

      const data = await response.json();

      if (data.success) {
        // Update local state
        setPhotos((prevPhotos) =>
          prevPhotos.map((p) =>
            p.id === photo.id ? { ...p, is_favorite: data.is_favorite } : p,
          ),
        );
      }
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    }
  };

  // Don't render if there are no photos
  if (!loading && photos.length === 0) {
    return null;
  }

  return (
    <>
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-orange-500" />
            <h2 className="text-lg font-medium text-gray-900">
              Rediscover Your Photos
            </h2>
          </div>
          <button
            onClick={loadRandomPhotos}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-orange-500 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Load new random photos"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        
        <p className="text-sm text-gray-600 mb-4">
          A random selection from your entire photo collection to help you rediscover forgotten memories.
        </p>

        <div className="photo-mosaic grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {loading ? (
            Array.from({ length: 32 }).map((_, index) => (
              <PhotoSkeleton key={index} />
            ))
          ) : (
            photos.map((photo, index) => (
              <PhotoItem
                key={photo.id}
                photo={photo}
                onPhotoClick={handlePhotoSelect}
                onToggleFavorite={toggleFavorite}
                priority={index < 16 ? 8 - Math.floor(index / 2) : 0} // First 16 images get priority
              />
            ))
          )}
        </div>
      </div>

      {selectedPhoto && (
        <PhotoViewer
          photo={selectedPhoto}
          photos={photos}
          onClose={handlePhotoClose}
          onFavoriteToggle={(updatedPhoto) => {
            setPhotos((prevPhotos) =>
              prevPhotos.map((p) =>
                p.id === updatedPhoto.id ? updatedPhoto : p
              )
            );
          }}
          onPhotoChange={(newPhoto) => {
            setSelectedPhoto(newPhoto);
            onPhotoUrlChange?.(newPhoto.id.toString());
          }}
        />
      )}
    </>
  );
}