"use client";

import { useEffect, useState, useCallback } from "react";
import { Photo } from "@/types";
import { X, Download, Calendar, MapPin, HardDrive, Heart, ChevronLeft, ChevronRight, Play, Pause, ImageOff, AlertCircle, ChevronRight as ChevronRightIcon } from "lucide-react";

interface PhotoViewerProps {
  photo: Photo;
  photos?: Photo[]; // Array of all photos for navigation
  onClose: () => void;
  onFavoriteToggle?: (photo: Photo) => void;
  onPhotoChange?: (photo: Photo) => void; // Callback when photo changes
}

export default function PhotoViewer({ photo, photos, onClose, onFavoriteToggle, onPhotoChange }: PhotoViewerProps) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [currentPhoto, setCurrentPhoto] = useState(photo);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSlideshow, setIsSlideshow] = useState(false);
  const [preloadedImages, setPreloadedImages] = useState<Set<string>>(new Set());
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [currentFavoriteState, setCurrentFavoriteState] = useState(photo.is_favorite);

  // Initialize current index based on selected photo
  useEffect(() => {
    if (photos) {
      const index = photos.findIndex(p => p.id === photo.id);
      setCurrentIndex(index !== -1 ? index : 0);
    }
  }, [photo.id, photos]);

  // Handle photo change - only reset loading when the photo actually changes
  useEffect(() => {
    setCurrentPhoto(photo);
    setCurrentFavoriteState(photo.is_favorite);
    setImageLoading(true);
    setImageError(false);
  }, [photo.id]); // Only depend on photo.id, not the full photo object

  // Preload nearby images for smooth navigation
  const preloadImages = useCallback((centerIndex: number) => {
    if (!photos) return;
    
    // Preload 2-3 images ahead and 1 behind
    const indicesToPreload = [
      centerIndex + 1,
      centerIndex + 2,
      centerIndex + 3,
      centerIndex - 1
    ].filter(index => index >= 0 && index < photos.length);

    indicesToPreload.forEach(index => {
      const photoId = photos[index].id.toString();
      if (!preloadedImages.has(photoId)) {
        const img = new Image();
        img.src = `/api/photos/${photos[index].id}/download`;
        img.onload = () => {
          setPreloadedImages(prev => new Set([...prev, photoId]));
        };
      }
    });
  }, [photos, preloadedImages]);

  // Preload images when current index changes
  useEffect(() => {
    preloadImages(currentIndex);
  }, [currentIndex, preloadImages]);

  // Navigation functions
  const goToPrevious = useCallback(() => {
    if (!photos || currentIndex <= 0) return;
    const newIndex = currentIndex - 1;
    const newPhoto = photos[newIndex];
    setCurrentIndex(newIndex);
    setCurrentPhoto(newPhoto);
    setCurrentFavoriteState(newPhoto.is_favorite);
    setImageLoading(true);
    setImageError(false);
    onPhotoChange?.(newPhoto);
  }, [photos, currentIndex, onPhotoChange]);

  const goToNext = useCallback(() => {
    if (!photos || currentIndex >= photos.length - 1) return;
    const newIndex = currentIndex + 1;
    const newPhoto = photos[newIndex];
    setCurrentIndex(newIndex);
    setCurrentPhoto(newPhoto);
    setCurrentFavoriteState(newPhoto.is_favorite);
    setImageLoading(true);
    setImageError(false);
    onPhotoChange?.(newPhoto);
  }, [photos, currentIndex, onPhotoChange]);

  // Auto-advance for slideshow
  useEffect(() => {
    if (!isSlideshow || !photos) return;
    
    const interval = setInterval(() => {
      if (currentIndex < photos.length - 1) {
        goToNext();
      } else {
        setIsSlideshow(false); // Stop at the end
      }
    }, 3000); // 3 seconds per photo

    return () => clearInterval(interval);
  }, [isSlideshow, currentIndex, photos, goToNext]);

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
        setIsSlideshow(prev => !prev);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [onClose, goToPrevious, goToNext]);

  const handleDownload = async () => {
    try {
      // Use a simple window.open or direct link approach for downloads
      // This is more reliable for large files and redirects
      const downloadUrl = `/api/photos/${currentPhoto.id}/download`;
      
      // Create a temporary anchor element to trigger download
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = currentPhoto.filename;
      a.target = "_blank";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      console.error("[CLIENT] Download failed:", error);
      // Fallback: open in new tab
      window.open(`/api/photos/${currentPhoto.id}/download`, '_blank');
    }
  };

  const handleFavoriteToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (favoriteLoading) return; // Prevent multiple clicks
    
    setFavoriteLoading(true);
    const originalState = currentFavoriteState;
    
    try {
      // Optimistically update the UI - only the favorite state, not the whole photo object
      setCurrentFavoriteState(!currentFavoriteState);
      
      const response = await fetch(`/api/photos/${currentPhoto.id}/favorite`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();

      if (data.success) {
        // Update the separate favorite state
        setCurrentFavoriteState(data.is_favorite);
        // Create updated photo for the parent callback without affecting our state
        const updatedPhoto = { ...currentPhoto, is_favorite: data.is_favorite };
        onFavoriteToggle?.(updatedPhoto);
      } else {
        // Revert favorite state on server error
        setCurrentFavoriteState(originalState);
        console.error("Server error toggling favorite:", data.error);
      }
    } catch (error) {
      // Revert favorite state on network error
      setCurrentFavoriteState(originalState);
      console.error("Failed to toggle favorite:", error);
    } finally {
      setFavoriteLoading(false);
    }
  };

  const getFolderBreadcrumbs = (s3Key: string) => {
    const pathParts = s3Key.split('/');
    pathParts.pop(); // Remove filename
    
    if (pathParts.length === 0) return [];
    
    return pathParts.map((folderName, index) => ({
      name: folderName,
      path: pathParts.slice(0, index + 1).join('/'),
    }));
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
            <h3 className="text-lg font-medium mb-1">{currentPhoto.filename}</h3>
            
            {/* Folder breadcrumb - clickable path navigation, especially useful in favorites */}
            {(() => {
              const breadcrumbs = getFolderBreadcrumbs(currentPhoto.s3_key);
              return breadcrumbs.length > 0 && (
                <div className="text-sm text-gray-400 mb-3 flex items-center flex-wrap">
                  <span className="mr-2">📁</span>
                  {breadcrumbs.map((crumb, index) => (
                    <div key={crumb.path} className="flex items-center">
                      {index > 0 && <ChevronRightIcon className="w-3 h-3 mx-1 text-gray-500" />}
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
              );
            })()}

            {/* Metadata section moved to top */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-300">
              <div className="flex items-center">
                <HardDrive className="w-4 h-4 mr-1" />
                {formatFileSize(currentPhoto.size)}
              </div>
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

          <div className="flex items-center space-x-2 flex-shrink-0">
            {/* Photo counter */}
            {photos && photos.length > 1 && (
              <div className="text-sm text-gray-300 bg-black bg-opacity-30 px-3 py-1 rounded-lg">
                {currentIndex + 1} of {photos.length}
              </div>
            )}

            {/* Slideshow controls */}
            {photos && photos.length > 1 && (
              <button
                onClick={() => setIsSlideshow(prev => !prev)}
                className={`p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors ${
                  isSlideshow ? "bg-white bg-opacity-20" : ""
                }`}
                title={isSlideshow ? "Pause slideshow (Space)" : "Start slideshow (Space)"}
              >
                {isSlideshow ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
            )}

            <button
              onClick={handleFavoriteToggle}
              disabled={favoriteLoading}
              className={`p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors relative ${
                favoriteLoading ? "opacity-50 cursor-not-allowed" : ""
              }`}
              title={favoriteLoading ? "Updating..." : currentFavoriteState ? "Remove from favorites" : "Add to favorites"}
            >
              {favoriteLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Heart
                  className={`w-5 h-5 transition-colors ${
                    currentFavoriteState
                      ? "text-red-500 fill-current"
                      : "text-white hover:text-red-400"
                  }`}
                />
              )}
            </button>
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

        <div className="flex-1 flex items-center justify-center min-h-0 relative group">
          {/* Loading skeleton */}
          {imageLoading && (
            <div className="absolute inset-4 bg-gray-800 rounded-lg flex items-center justify-center">
              <div className="w-16 h-16 border-4 border-gray-600 border-t-white rounded-full animate-spin"></div>
            </div>
          )}

          {/* Error state */}
          {imageError && (
            <div className="text-white text-center p-8 max-w-md mx-auto">
              {(() => {
                const filename = currentPhoto.filename.toLowerCase();
                const rawFormats = ['.nef', '.cr2', '.cr3', '.arw', '.dng', '.raf', '.orf', '.rw2', '.pef', '.srw', '.x3f'];
                const isRawFormat = rawFormats.some(ext => filename.endsWith(ext));
                
                if (isRawFormat) {
                  return (
                    <>
                      <ImageOff className="w-16 h-16 mx-auto mb-6 text-yellow-500" />
                      <h3 className="text-xl font-medium mb-2">RAW File Preview Unavailable</h3>
                      <p className="text-gray-300 mb-4">
                        This is a camera RAW file ({currentPhoto.filename.split('.').pop()?.toUpperCase()}) which cannot be displayed directly in the browser.
                      </p>
                      <div className="bg-gray-800 rounded-lg p-4 text-sm text-left space-y-2">
                        <p className="text-gray-300">To view this image:</p>
                        <ul className="list-disc list-inside space-y-1 text-gray-400">
                          <li>Download the file using the button above</li>
                          <li>Open with photo editing software (Lightroom, Photoshop, etc.)</li>
                          <li>Use RAW processing tools to convert and edit</li>
                        </ul>
                      </div>
                      <p className="text-xs text-gray-400 mt-4">{currentPhoto.filename}</p>
                    </>
                  );
                } else {
                  return (
                    <>
                      <AlertCircle className="w-16 h-16 mx-auto mb-6 text-red-500" />
                      <h3 className="text-xl font-medium mb-2">Failed to Load Image</h3>
                      <p className="text-gray-300 mb-4">
                        There was an error loading this image. It may be corrupted or in an unsupported format.
                      </p>
                      <p className="text-xs text-gray-400">{currentPhoto.filename}</p>
                    </>
                  );
                }
              })()}
            </div>
          )}

          {/* Navigation hints */}
          {photos && photos.length > 1 && !imageLoading && !imageError && (
            <>
              {/* Previous photo hint */}
              {currentIndex > 0 && (
                <button
                  onClick={goToPrevious}
                  className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 text-white rounded-full p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 hover:bg-opacity-70 z-10"
                  title="Previous photo (←)"
                >
                  <ChevronLeft className="w-8 h-8" />
                </button>
              )}
              
              {/* Next photo hint */}
              {currentIndex < photos.length - 1 && (
                <button
                  onClick={goToNext}
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 text-white rounded-full p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 hover:bg-opacity-70 z-10"
                  title="Next photo (→)"
                >
                  <ChevronRight className="w-8 h-8" />
                </button>
              )}
            </>
          )}

          {/* Main image */}
          <img
            src={`/api/photos/${currentPhoto.id}/download`}
            alt={currentPhoto.filename}
            className={`max-w-full max-h-full object-contain transition-opacity duration-200 ${
              imageLoading || imageError ? "opacity-0" : "opacity-100"
            }`}
            loading="eager"
            onLoad={() => setImageLoading(false)}
            onError={(e) => {
              console.log('PhotoViewer image error:', {
                filename: currentPhoto.filename,
                src: e.currentTarget.src,
                naturalWidth: e.currentTarget.naturalWidth,
                naturalHeight: e.currentTarget.naturalHeight
              });
              setImageLoading(false);
              setImageError(true);
            }}
          />
        </div>
      </div>
    </div>
  );
}
