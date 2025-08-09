"use client";

import { useState, useEffect } from "react";
import { Photo } from "@/types";
import { Heart, AlertTriangle, ImageOff } from "lucide-react";
import PhotoTooltip from "./PhotoTooltip";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { useThumbnailLoader } from "@/hooks/useThumbnailLoader";

interface PhotoItemProps {
  photo: Photo;
  onPhotoClick: (photo: Photo) => void;
  onToggleFavorite: (photo: Photo, event: React.MouseEvent) => void;
  priority?: number;
  isSharedView?: boolean;
  shareToken?: string;
  sessionToken?: string;
}

export default function PhotoItem({
  photo,
  onPhotoClick,
  onToggleFavorite,
  priority = 0,
  isSharedView = false,
  shareToken,
  sessionToken,
}: PhotoItemProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const { elementRef, shouldLoad } = useIntersectionObserver({
    rootMargin: '200px', // Start loading when 200px away
    threshold: 0.1,
  });

  // Get the correct thumbnail URL based on whether this is a shared view
  const getThumbnailUrl = () => {
    if (!shouldLoad) return '';
    
    if (isSharedView && shareToken) {
      // Use shared thumbnail endpoint (no auth needed for thumbnails in shared view)
      return `/api/shares/${shareToken}/thumbnail/${photo.id}`;
    } else {
      // Use regular thumbnail URL
      return photo.thumbnail_url;
    }
  };

  const { blob, isLoading, error } = useThumbnailLoader(
    getThumbnailUrl(),
    priority
  );


  useEffect(() => {
    if (blob) {
      const url = URL.createObjectURL(blob);
      setImageUrl(url);
      
      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [blob]);

  return (
    <PhotoTooltip photo={photo}>
      <div
        ref={elementRef as any}
        className="photo-mosaic-item group relative aspect-square bg-gray-100 overflow-hidden cursor-pointer"
        onClick={() => onPhotoClick(photo)}
      >
        {/* Error state */}
        {error && !imageUrl && (
          <div className="absolute inset-0 bg-slate-100 overflow-hidden">
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 p-2">
              <ImageOff className="w-5 h-5 mb-1.5" />
              <span className="text-xs text-center leading-tight font-medium mb-1">
                {(() => {
                  const filename = photo.filename.toLowerCase();
                  const rawFormats = ['.nef', '.cr2', '.cr3', '.arw', '.dng', '.raf', '.orf', '.rw2', '.pef', '.srw', '.x3f'];
                  const isRawFormat = rawFormats.some(ext => filename.endsWith(ext));
                  
                  if (isRawFormat) {
                    return 'RAW';
                  } else if (error?.message?.includes('Unsupported image format')) {
                    return 'Unsupported';
                  } else {
                    return 'No preview';
                  }
                })()}
              </span>
              <span className="text-xs text-center text-slate-500 opacity-75 truncate max-w-full">
                {photo.filename}
              </span>
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {(isLoading || (!imageUrl && !error)) && (
          <div className="absolute inset-0 bg-slate-100 overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-2 h-2 bg-slate-400 rounded-full animate-pulse-dots"
                    style={{
                      animationDelay: `${i * 0.15}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {imageUrl && (
          <img
            src={imageUrl}
            alt={photo.filename}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          />
        )}
        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-opacity duration-200" />

        {/* Favorite heart icon - only show in regular view */}
        {!isSharedView && (
          <button
            onClick={(e) => onToggleFavorite(photo, e)}
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
        )}
      </div>
    </PhotoTooltip>
  );
}