"use client";

import { useEffect, useState } from "react";
import { Photo } from "@/types";
import { X, Download, Calendar, MapPin, HardDrive } from "lucide-react";

interface PhotoViewerProps {
  photo: Photo;
  onClose: () => void;
}

export default function PhotoViewer({ photo, onClose }: PhotoViewerProps) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [onClose]);

  const handleDownload = async () => {
    try {
      const response = await fetch(`/api/photos/${photo.id}/download`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = photo.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("[CLIENT] Download failed:", error);
    }
  };

  const formatFileSize = (bytes: number) => {
    const sizes = ["Bytes", "KB", "MB", "GB"];
    if (bytes === 0) return "0 Bytes";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  };

  const handleBackgroundClick = (e: React.MouseEvent) => {
    // Only close if clicked on the background, not the content
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4 cursor-pointer"
      onClick={handleBackgroundClick}
    >
      <div className="relative max-w-4xl max-h-full w-full h-full flex flex-col cursor-default">
        <div className="flex justify-between items-start p-4 bg-black bg-opacity-50 text-white">
          <div className="flex-1 mr-4">
            <h3 className="text-lg font-medium mb-3">{photo.filename}</h3>

            {/* Metadata section moved to top */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-300">
              <div className="flex items-center">
                <HardDrive className="w-4 h-4 mr-1" />
                {formatFileSize(photo.size)}
              </div>
              {photo.metadata?.date_taken && (
                <div className="flex items-center">
                  <Calendar className="w-4 h-4 mr-1" />
                  {new Date(photo.metadata.date_taken).toLocaleString()}
                </div>
              )}
              {photo.metadata?.dimensions && (
                <div className="flex items-center">
                  <span className="mr-1">📐</span>
                  {photo.metadata.dimensions.width} ×{" "}
                  {photo.metadata.dimensions.height}
                </div>
              )}
              {photo.metadata?.location && (
                <div className="flex items-center">
                  <MapPin className="w-4 h-4 mr-1" />
                  {photo.metadata.location.latitude.toFixed(4)},{" "}
                  {photo.metadata.location.longitude.toFixed(4)}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2 flex-shrink-0">
            <button
              onClick={handleDownload}
              className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
              title="Download original"
            >
              <Download className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center min-h-0 relative">
          {/* Loading skeleton */}
          {imageLoading && (
            <div className="absolute inset-4 bg-gray-800 rounded-lg animate-pulse flex items-center justify-center">
              <div className="w-16 h-16 border-4 border-gray-600 border-t-white rounded-full animate-spin"></div>
            </div>
          )}

          {/* Error state */}
          {imageError && (
            <div className="text-white text-center p-8">
              <div className="text-6xl mb-4">⚠️</div>
              <p className="text-lg">Failed to load image</p>
              <p className="text-sm text-gray-400 mt-2">{photo.filename}</p>
            </div>
          )}

          {/* Main image */}
          <img
            src={`/api/photos/${photo.id}/download`}
            alt={photo.filename}
            className={`max-w-full max-h-full object-contain transition-opacity duration-200 ${
              imageLoading || imageError ? "opacity-0" : "opacity-100"
            }`}
            loading="eager"
            onLoad={() => setImageLoading(false)}
            onError={() => {
              setImageLoading(false);
              setImageError(true);
            }}
          />
        </div>
      </div>
    </div>
  );
}
