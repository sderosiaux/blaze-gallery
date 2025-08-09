"use client";

import { useState } from "react";
import { Photo } from "@/types";
import { Heart } from "lucide-react";
import PhotoTooltip from "./PhotoTooltip";

interface PhotoItemProps {
  photo: Photo;
  onPhotoClick: (photo: Photo) => void;
  onToggleFavorite: (photo: Photo, event: React.MouseEvent) => void;
}

export default function PhotoItem({
  photo,
  onPhotoClick,
  onToggleFavorite,
}: PhotoItemProps) {
  const [imageLoading, setImageLoading] = useState(true);

  return (
    <PhotoTooltip photo={photo}>
      <div
        className="photo-mosaic-item group relative aspect-square bg-gray-100 overflow-hidden cursor-pointer"
        onClick={() => onPhotoClick(photo)}
      >
        {/* Loading skeleton */}
        {imageLoading && (
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

        <img
          src={photo.thumbnail_url}
          alt={photo.filename}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          loading="lazy"
          onLoad={() => setImageLoading(false)}
          onError={() => setImageLoading(false)}
        />
        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-opacity duration-200" />

        {/* Favorite heart icon - always visible if favorited, only on hover if not */}
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
      </div>
    </PhotoTooltip>
  );
}