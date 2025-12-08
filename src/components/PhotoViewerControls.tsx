"use client";

import {
  X,
  Download,
  Heart,
  Play,
  Pause,
  Expand,
  Minimize2,
} from "lucide-react";

interface PhotoViewerControlsProps {
  /** Total number of photos for navigation */
  totalPhotos: number;
  /** Current index in the photos array */
  currentIndex: number;
  /** Whether slideshow mode is active */
  isSlideshow: boolean;
  /** Toggle slideshow mode */
  onSlideshowToggle: () => void;
  /** Whether image is expanded */
  isExpanded: boolean;
  /** Toggle expanded mode */
  onExpandToggle: () => void;
  /** Whether this is a shared view (hides favorite button) */
  isSharedView: boolean;
  /** Whether favorite operation is in progress */
  favoriteLoading: boolean;
  /** Current favorite state of the photo */
  isFavorite: boolean;
  /** Whether heart animation is playing */
  heartAnimating: boolean;
  /** Handle favorite toggle */
  onFavoriteToggle: () => void;
  /** Whether download is allowed */
  allowDownload: boolean;
  /** Handle download */
  onDownload: () => void;
  /** Handle close */
  onClose: () => void;
}

export default function PhotoViewerControls({
  totalPhotos,
  currentIndex,
  isSlideshow,
  onSlideshowToggle,
  isExpanded,
  onExpandToggle,
  isSharedView,
  favoriteLoading,
  isFavorite,
  heartAnimating,
  onFavoriteToggle,
  allowDownload,
  onDownload,
  onClose,
}: PhotoViewerControlsProps) {
  return (
    <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
      {/* Photo counter */}
      {totalPhotos > 1 && (
        <div className="text-sm text-gray-300 bg-black bg-opacity-30 px-3 py-1 rounded-lg">
          {currentIndex + 1} of {totalPhotos}
        </div>
      )}

      {/* Slideshow controls */}
      {totalPhotos > 1 && (
        <button
          onClick={onSlideshowToggle}
          className={`p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors ${
            isSlideshow ? "bg-white bg-opacity-20" : ""
          }`}
          title={
            isSlideshow ? "Pause slideshow (Space)" : "Start slideshow (Space)"
          }
        >
          {isSlideshow ? (
            <Pause className="w-5 h-5" />
          ) : (
            <Play className="w-5 h-5" />
          )}
        </button>
      )}

      <button
        onClick={onExpandToggle}
        className={`p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors ${
          isExpanded ? "bg-white bg-opacity-20" : ""
        }`}
        title={isExpanded ? "Fit to screen (E)" : "Expand image (E)"}
      >
        {isExpanded ? (
          <Minimize2 className="w-5 h-5" />
        ) : (
          <Expand className="w-5 h-5" />
        )}
      </button>

      {/* Favorite button - only show in regular view */}
      {!isSharedView && (
        <button
          onClick={onFavoriteToggle}
          disabled={favoriteLoading}
          className={`p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors relative ${
            favoriteLoading ? "opacity-50 cursor-not-allowed" : ""
          }`}
          title={
            favoriteLoading
              ? "Updating..."
              : isFavorite
                ? "Remove from favorites (F)"
                : "Add to favorites (F)"
          }
        >
          {favoriteLoading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Heart
              className={`w-5 h-5 transition-all duration-300 ease-out ${
                isFavorite
                  ? "text-red-500 fill-current"
                  : "text-white hover:text-red-400"
              } ${
                heartAnimating
                  ? "transform scale-125 rotate-12"
                  : "transform scale-100 rotate-0"
              }`}
              style={{
                filter: heartAnimating
                  ? "drop-shadow(0 0 8px rgba(239, 68, 68, 0.6))"
                  : "none",
              }}
            />
          )}
        </button>
      )}

      {/* Download button - only show if downloads are allowed */}
      {allowDownload && (
        <button
          onClick={onDownload}
          className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
          title="Download original"
        >
          <Download className="w-5 h-5" />
        </button>
      )}

      <button
        onClick={onClose}
        className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
        title="Close (Esc)"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
