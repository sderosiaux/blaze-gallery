"use client";

import { useEffect, useCallback, useState } from "react";
import { Photo } from "@/types";
import {
  Calendar,
  MapPin,
  HardDrive,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  AlertCircle,
  ChevronRight as ChevronRightIcon,
} from "lucide-react";
import PhotoViewerControls from "./PhotoViewerControls";
import { useImageLoading } from "@/hooks/useImageLoading";
import { useFavoriteToggle } from "@/hooks/useFavoriteToggle";
import { usePhotoNavigation } from "@/hooks/usePhotoNavigation";
import { formatFileSize } from "@/lib/format";

// Helper to check if a file is a video based on mime_type
function isVideoMimeType(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

/**
 * Trigger a file download via anchor element
 * Handles both blob URLs and regular URLs
 */
function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

interface PhotoViewerProps {
  photo: Photo;
  photos?: Photo[]; // Array of all photos for navigation
  onClose: () => void;
  onFavoriteToggle?: (photo: Photo) => void;
  onPhotoChange?: (photo: Photo) => void; // Callback when photo changes
  isSharedView?: boolean;
  shareToken?: string;
  allowDownload?: boolean;
  sessionToken?: string;
}

export default function PhotoViewer({
  photo,
  photos,
  onClose,
  onFavoriteToggle,
  onPhotoChange,
  isSharedView = false,
  shareToken,
  allowDownload = true,
  sessionToken,
}: PhotoViewerProps) {
  // Use custom hooks for grouped state management
  const [imageState, imageActions] = useImageLoading(photo.id);
  const [favoriteState, favoriteActions] = useFavoriteToggle(photo.is_favorite, isSharedView);
  const [navState, navActions] = usePhotoNavigation(photo, photos, onPhotoChange);

  // UI state - single useState for simple toggle
  const [isExpanded, setIsExpanded] = useState(false);

  // Sync favorite state when photo changes
  useEffect(() => {
    favoriteActions.setFavorite(photo.is_favorite);
  }, [photo.is_favorite, favoriteActions]);

  // Helper functions to get correct URLs for shared vs regular views
  const getThumbnailUrl = (photoId: number) => {
    if (isSharedView && shareToken) {
      return `/api/shares/${shareToken}/thumbnail/${photoId}`;
    } else {
      return `/api/photos/${photoId}/thumbnail`;
    }
  };

  const getFullImageUrl = (photoId: number) => {
    if (isSharedView && shareToken) {
      // Use view endpoint for displaying images (always allowed)
      return `/api/shares/${shareToken}/view/${photoId}`;
    } else {
      return `/api/photos/${photoId}/download`;
    }
  };

  // Session-based image loading for password-protected shares
  useEffect(() => {
    if (isSharedView && shareToken && sessionToken && photo.id) {
      let isCancelled = false;
      const abortController = new AbortController();

      const loadSessionImage = async () => {
        try {
          const response = await fetch(
            `/api/shares/${shareToken}/view/${photo.id}`,
            {
              headers: { "x-share-session": sessionToken },
              signal: abortController.signal,
            },
          );

          if (isCancelled) return;

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const blob = await response.blob();
          if (isCancelled) {
            URL.revokeObjectURL(URL.createObjectURL(blob));
            return;
          }

          imageActions.setBlobUrl(URL.createObjectURL(blob));
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (!isCancelled) {
            console.error("Failed to load full image with session:", error);
            imageActions.setError();
          }
        }
      };

      loadSessionImage();

      return () => {
        isCancelled = true;
        abortController.abort();
      };
    }
  }, [photo.id, isSharedView, shareToken, sessionToken, imageActions]);

  // Preload nearby images for smooth navigation
  const preloadImages = useCallback(
    (centerIndex: number) => {
      if (!photos) return;

      // Skip preloading for password-protected shares since they need session authentication
      if (isSharedView && sessionToken) return;

      const indicesToPreload = [
        centerIndex + 1,
        centerIndex + 2,
        centerIndex + 3,
        centerIndex - 1,
      ].filter((index) => index >= 0 && index < photos.length);

      indicesToPreload.forEach((index) => {
        const photoId = photos[index].id.toString();
        if (!navState.preloadedIds.has(photoId)) {
          const img = new Image();
          img.src = getFullImageUrl(photos[index].id);
          img.onload = () => navActions.markPreloaded(photoId);
        }
      });
    },
    [photos, navState.preloadedIds, isSharedView, sessionToken, navActions],
  );

  // Preload images when current index changes
  useEffect(() => {
    preloadImages(navState.currentIndex);
  }, [navState.currentIndex, preloadImages]);

  // Navigation wrapper functions that also reset image loading state
  const goToPrevious = useCallback(() => {
    const newPhoto = navActions.goToPrevious();
    if (newPhoto) {
      imageActions.reset();
      favoriteActions.setFavorite(newPhoto.is_favorite);
    }
  }, [navActions, imageActions, favoriteActions]);

  const goToNext = useCallback(() => {
    const newPhoto = navActions.goToNext();
    if (newPhoto) {
      imageActions.reset();
      favoriteActions.setFavorite(newPhoto.is_favorite);
    }
  }, [navActions, imageActions, favoriteActions]);

  // Handle favorite toggle using the hook
  const handleFavoriteToggle = useCallback(
    (e: React.MouseEvent | KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      favoriteActions.toggle(navState.currentPhoto, onFavoriteToggle);
    },
    [favoriteActions, navState.currentPhoto, onFavoriteToggle],
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrevious();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNext();
      } else if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        navActions.toggleSlideshow();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        handleFavoriteToggle(e);
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setIsExpanded((prev) => !prev);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [onClose, goToPrevious, goToNext, navActions, handleFavoriteToggle]);

  const handleDownload = async () => {
    const currentPhoto = navState.currentPhoto;
    try {
      if (isSharedView && shareToken) {
        const response = await fetch(
          `/api/shares/${shareToken}/download/${currentPhoto.id}`,
          {
            headers: sessionToken ? { "x-share-session": sessionToken } : {},
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        triggerDownload(url, currentPhoto.filename);
        URL.revokeObjectURL(url);
      } else {
        triggerDownload(
          `/api/photos/${currentPhoto.id}/download`,
          currentPhoto.filename,
        );
      }
    } catch (error) {
      console.error("[CLIENT] Download failed:", error);
      alert("Download failed. Please try again.");
    }
  };

  const getFolderBreadcrumbs = (s3Key: string) => {
    const pathParts = s3Key.split("/");
    pathParts.pop(); // Remove filename

    if (pathParts.length === 0) return [];

    return pathParts.map((folderName, index) => ({
      name: folderName,
      path: pathParts.slice(0, index + 1).join("/"),
    }));
  };

  const handleBackgroundClick = (e: React.MouseEvent) => {
    // Only close if clicked on the background, not the content
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Destructure for cleaner JSX
  const currentPhoto = navState.currentPhoto;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4 cursor-pointer"
      onClick={handleBackgroundClick}
    >
      <div className="relative max-w-4xl max-h-full w-full h-full flex flex-col cursor-default">
        <div className="flex flex-col p-4 bg-black bg-opacity-50 text-white">
          {/* Top row: filename, size, and buttons */}
          <div className="flex justify-between items-start mb-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center flex-wrap gap-3">
                <h3 className="text-lg font-medium truncate">
                  {currentPhoto.filename}
                </h3>
                <div className="flex items-center text-sm text-gray-300">
                  <HardDrive className="w-4 h-4 mr-1" />
                  {formatFileSize(currentPhoto.size)}
                </div>
              </div>
            </div>
            <PhotoViewerControls
              totalPhotos={photos?.length ?? 0}
              currentIndex={navState.currentIndex}
              isSlideshow={navState.isSlideshow}
              onSlideshowToggle={navActions.toggleSlideshow}
              isExpanded={isExpanded}
              onExpandToggle={() => setIsExpanded((prev) => !prev)}
              isSharedView={isSharedView}
              favoriteLoading={favoriteState.isLoading}
              isFavorite={favoriteState.isFavorite}
              heartAnimating={favoriteState.isAnimating}
              onFavoriteToggle={() =>
                handleFavoriteToggle({
                  preventDefault: () => {},
                  stopPropagation: () => {},
                } as React.MouseEvent)
              }
              allowDownload={allowDownload}
              onDownload={handleDownload}
              onClose={onClose}
            />
          </div>

          {/* Full width breadcrumb row */}
          <div className="w-full">
            {/* Folder breadcrumb - clickable path navigation, especially useful in favorites */}
            {(() => {
              const breadcrumbs = getFolderBreadcrumbs(currentPhoto.s3_key);
              return (
                breadcrumbs.length > 0 && (
                  <div className="text-sm text-gray-400 mb-3 flex items-center flex-wrap">
                    <span className="mr-2">📁</span>
                    {breadcrumbs.map((crumb, index) => (
                      <div key={crumb.path} className="flex items-center">
                        {index > 0 && (
                          <ChevronRightIcon className="w-3 h-3 mx-1 text-gray-500" />
                        )}
                        <a
                          href={`/folder/${crumb.path}`}
                          className="opacity-75 hover:opacity-100 hover:text-blue-300 transition-colors underline-offset-2 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent photo viewer from closing
                          }}
                          title={`Go to ${crumb.name} folder`}
                        >
                          {crumb.name}
                        </a>
                      </div>
                    ))}
                  </div>
                )
              );
            })()}

            {/* Metadata section */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-300">
              {currentPhoto.metadata?.date_taken && (
                <div className="flex items-center">
                  <Calendar className="w-4 h-4 mr-1" />
                  {new Date(currentPhoto.metadata.date_taken).toLocaleString()}
                </div>
              )}
              {currentPhoto.metadata?.dimensions && (
                <div className="flex items-center">
                  <span className="mr-1">📐</span>
                  {currentPhoto.metadata.dimensions.width} ×{" "}
                  {currentPhoto.metadata.dimensions.height}
                </div>
              )}
              {currentPhoto.metadata?.location && (
                <div className="flex items-center">
                  <MapPin className="w-4 h-4 mr-1" />
                  {currentPhoto.metadata.location.latitude.toFixed(4)},{" "}
                  {currentPhoto.metadata.location.longitude.toFixed(4)}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center min-h-0 relative group">
          {/* Loading skeleton - only show when no images are loaded yet and after delay */}
          {imageState.showLoadingUI && !imageState.thumbnailReady && !imageState.fullImageReady && (
            <div className="absolute inset-4 bg-gray-800 rounded-lg flex items-center justify-center">
              <div className="w-16 h-16 border-4 border-gray-600 border-t-white rounded-full animate-spin"></div>
            </div>
          )}

          {/* Error state */}
          {imageState.hasError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-white text-center p-8 max-w-md mx-auto">
                {(() => {
                  const filename = currentPhoto.filename.toLowerCase();
                  const rawFormats = [
                    ".nef",
                    ".cr2",
                    ".cr3",
                    ".arw",
                    ".dng",
                    ".raf",
                    ".orf",
                    ".rw2",
                    ".pef",
                    ".srw",
                    ".x3f",
                  ];
                  const isRawFormat = rawFormats.some((ext) =>
                    filename.endsWith(ext),
                  );

                  if (isRawFormat) {
                    return (
                      <>
                        <ImageOff className="w-16 h-16 mx-auto mb-6 text-yellow-500" />
                        <h3 className="text-xl font-medium mb-2">
                          RAW File Preview Unavailable
                        </h3>
                        <p className="text-gray-300 mb-4">
                          This is a camera RAW file (
                          {currentPhoto.filename
                            .split(".")
                            .pop()
                            ?.toUpperCase()}
                          ) which cannot be displayed directly in the browser.
                        </p>
                        <div className="bg-gray-800 rounded-lg p-4 text-sm text-left space-y-2">
                          <p className="text-gray-300">To view this image:</p>
                          <ul className="list-disc list-inside space-y-1 text-gray-400">
                            <li>Download the file using the button above</li>
                            <li>
                              Open with photo editing software (Lightroom,
                              Photoshop, etc.)
                            </li>
                            <li>
                              Use RAW processing tools to convert and edit
                            </li>
                          </ul>
                        </div>
                        <p className="text-xs text-gray-400 mt-4">
                          {currentPhoto.filename}
                        </p>
                      </>
                    );
                  } else {
                    return (
                      <>
                        <AlertCircle className="w-16 h-16 mx-auto mb-6 text-red-500" />
                        <h3 className="text-xl font-medium mb-2">
                          Failed to Load Image
                        </h3>
                        <p className="text-gray-300 mb-4">
                          There was an error loading this image. It may be
                          corrupted or in an unsupported format.
                        </p>
                        <p className="text-xs text-gray-400">
                          {currentPhoto.filename}
                        </p>
                      </>
                    );
                  }
                })()}
              </div>
            </div>
          )}

          {/* Navigation hints */}
          {photos &&
            photos.length > 1 &&
            (imageState.thumbnailReady || imageState.fullImageReady) &&
            !imageState.hasError && (
              <>
                {/* Previous photo hint */}
                {navState.hasPrevious && (
                  <button
                    onClick={goToPrevious}
                    className={`absolute top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 text-white rounded-full p-3 opacity-0 group-hover:opacity-100 transition-all duration-300 hover:bg-opacity-70 z-10 ${
                      isExpanded ? "-left-2" : "left-4"
                    }`}
                    title="Previous photo (←)"
                  >
                    <ChevronLeft className="w-8 h-8" />
                  </button>
                )}

                {/* Next photo hint */}
                {navState.hasNext && (
                  <button
                    onClick={goToNext}
                    className={`absolute top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 text-white rounded-full p-3 opacity-0 group-hover:opacity-100 transition-all duration-300 hover:bg-opacity-70 z-10 ${
                      isExpanded ? "-right-2" : "right-4"
                    }`}
                    title="Next photo (→)"
                  >
                    <ChevronRight className="w-8 h-8" />
                  </button>
                )}
              </>
            )}

          {/* Progressive Loading Images / Video Player */}
          <div className="relative w-full h-full flex items-center justify-center">
            {isVideoMimeType(currentPhoto.mime_type) ? (
              /* Video Player */
              <video
                key={currentPhoto.id}
                src={imageState.blobUrl || getFullImageUrl(currentPhoto.id)}
                controls
                autoPlay
                className={`transition-all duration-300 ${
                  isExpanded ? "max-w-none max-h-none" : "max-w-full max-h-full"
                }`}
                style={{
                  width: isExpanded ? "90vw" : "100%",
                  height: isExpanded ? "90vh" : "100%",
                  maxWidth: isExpanded ? "90vw" : "100%",
                  maxHeight: isExpanded ? "90vh" : "100%",
                  objectFit: "contain",
                }}
                onLoadedData={() => imageActions.setFullImageLoaded()}
                onError={() => imageActions.setError()}
              />
            ) : (
              <>
                {/* Thumbnail - loads first and shows immediately, sized to match final image */}
                <img
                  src={getThumbnailUrl(currentPhoto.id)}
                  alt={`${currentPhoto.filename} thumbnail`}
                  className={`absolute transition-all duration-500 ${
                    isExpanded
                      ? "max-w-none max-h-none object-contain"
                      : "max-w-full max-h-full object-contain"
                  } ${
                    imageState.thumbnailReady && !imageState.fullImageReady
                      ? "opacity-100"
                      : "opacity-0"
                  } ${
                    imageState.fullImageReady ? "scale-110 blur-sm" : "scale-100 blur-0"
                  }`}
                  style={{
                    imageRendering: "auto",
                    width: isExpanded ? "90vw" : "100%",
                    height: isExpanded ? "90vh" : "100%",
                    maxWidth: isExpanded ? "90vw" : "100%",
                    maxHeight: isExpanded ? "90vh" : "100%",
                    objectFit: "contain",
                  }}
                  loading="eager"
                  onLoad={() => imageActions.setThumbnailLoaded()}
                  onError={() => {
                    // For shared views, silently handle thumbnail errors
                    if (isSharedView) {
                      imageActions.clearLoadingTimeout();
                    } else {
                      console.log(
                        "Thumbnail load error for:",
                        currentPhoto.filename,
                      );
                    }
                  }}
                />

                {/* Full Resolution Image - loads in background, sized to match thumbnail */}
                <img
                  src={
                    // For password-protected shares, don't load until blob URL is ready
                    isSharedView && sessionToken && !imageState.blobUrl
                      ? ""
                      : imageState.blobUrl || getFullImageUrl(currentPhoto.id)
                  }
                  alt={currentPhoto.filename}
                  className={`transition-all duration-500 ${
                    isExpanded
                      ? "max-w-none max-h-none object-contain"
                      : "max-w-full max-h-full object-contain"
                  } ${imageState.fullImageReady ? "opacity-100" : "opacity-0"}`}
                  style={{
                    imageRendering: isExpanded ? "crisp-edges" : "auto",
                    width: isExpanded ? "90vw" : "100%",
                    height: isExpanded ? "90vh" : "100%",
                    maxWidth: isExpanded ? "90vw" : "100%",
                    maxHeight: isExpanded ? "90vh" : "100%",
                    objectFit: "contain",
                  }}
                  loading="eager"
                  onLoad={() => {
                    const isPasswordProtectedShare = isSharedView && sessionToken;
                    const isUsingBlobUrl = imageState.blobUrl !== null;

                    if (!isPasswordProtectedShare || isUsingBlobUrl) {
                      imageActions.setFullImageLoaded();
                    }
                  }}
                  onError={(e) => {
                    const isWaitingForSessionLoad =
                      isSharedView && sessionToken && !imageState.blobUrl;

                    if (!isWaitingForSessionLoad) {
                      console.log("PhotoViewer full image error:", {
                        filename: currentPhoto.filename,
                        src: e.currentTarget.src,
                        isSharedView,
                        sessionToken: !!sessionToken,
                        blobUrl: !!imageState.blobUrl,
                      });
                      setTimeout(() => imageActions.setError(), 100);
                    }
                  }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
