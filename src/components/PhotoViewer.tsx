"use client";

import { useEffect, useState, useCallback } from "react";
import { Photo } from "@/types";
import { X, Download, Calendar, MapPin, HardDrive, Heart, ChevronLeft, ChevronRight, Play, Pause, ImageOff, AlertCircle, ChevronRight as ChevronRightIcon, Expand, Minimize2 } from "lucide-react";
import { loadImageWithSession, revokeBlobUrl } from "@/lib/shareClient";

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
  sessionToken
}: PhotoViewerProps) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [currentPhoto, setCurrentPhoto] = useState(photo);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSlideshow, setIsSlideshow] = useState(false);
  const [preloadedImages, setPreloadedImages] = useState<Set<string>>(new Set());
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [currentFavoriteState, setCurrentFavoriteState] = useState(photo.is_favorite);
  const [heartAnimating, setHeartAnimating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [loadingTimeoutRef, setLoadingTimeoutRef] = useState<NodeJS.Timeout | null>(null);
  
  // Progressive loading states
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false);
  const [fullImageLoaded, setFullImageLoaded] = useState(false);
  
  // Blob URLs for shared images (when session authentication is required)
  const [fullImageBlobUrl, setFullImageBlobUrl] = useState<string | null>(null);

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

  // Helper function to manage loading timeout
  const setLoadingWithDelay = () => {
    // Clear any existing timeout
    if (loadingTimeoutRef) {
      clearTimeout(loadingTimeoutRef);
    }
    
    setShowLoading(false);
    const timeout = setTimeout(() => {
      setShowLoading(true);
    }, 150);
    
    setLoadingTimeoutRef(timeout);
  };

  // Helper function to clear loading timeout
  const clearLoadingTimeout = () => {
    if (loadingTimeoutRef) {
      clearTimeout(loadingTimeoutRef);
      setLoadingTimeoutRef(null);
    }
    setShowLoading(false);
  };

  // Initialize current index based on selected photo
  useEffect(() => {
    if (photos) {
      const index = photos.findIndex(p => p.id === photo.id);
      setCurrentIndex(index !== -1 ? index : 0);
    }
  }, [photo.id, photos]);

  // Load full image with session authentication for password-protected shared views
  const loadFullImageWithSession = useCallback(async (photoId: number) => {
    // Only use session loading for shared views that have session tokens (password-protected)
    if (isSharedView && shareToken && sessionToken) {
      try {
        const response = await fetch(`/api/shares/${shareToken}/view/${photoId}`, {
          headers: { 'x-share-session': sessionToken }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        // Clean up previous blob URL
        if (fullImageBlobUrl) {
          URL.revokeObjectURL(fullImageBlobUrl);
        }
        
        setFullImageBlobUrl(blobUrl);
        setImageLoading(false);
        setFullImageLoaded(true);
        clearLoadingTimeout();
      } catch (error) {
        console.error('Failed to load full image with session:', error);
        setImageLoading(false);
        setImageError(true);
        clearLoadingTimeout();
      }
    }
  }, [isSharedView, shareToken, sessionToken, clearLoadingTimeout]);

  // Handle photo change - only reset loading when the photo actually changes
  useEffect(() => {
    setCurrentPhoto(photo);
    setCurrentFavoriteState(photo.is_favorite);
    setImageLoading(true);
    setImageError(false);
    
    // Reset progressive loading states
    setThumbnailLoaded(false);
    setFullImageLoaded(false);
    
    // Clean up previous blob URL
    if (fullImageBlobUrl) {
      URL.revokeObjectURL(fullImageBlobUrl);
      setFullImageBlobUrl(null);
    }
    
    setLoadingWithDelay();
    
    return () => {
      if (loadingTimeoutRef) {
        clearTimeout(loadingTimeoutRef);
      }
    };
  }, [photo.id]); // Only depend on photo.id to prevent loops
  
  // Separate effect for session-based loading with race condition prevention
  useEffect(() => {
    // Load full image for password-protected shared views only
    if (isSharedView && shareToken && sessionToken && photo.id) {
      let isCancelled = false; // Flag to prevent race conditions
      const abortController = new AbortController(); // Cancel in-flight requests
      
      const loadSessionImage = async () => {
        try {
          const response = await fetch(`/api/shares/${shareToken}/view/${photo.id}`, {
            headers: { 'x-share-session': sessionToken },
            signal: abortController.signal // Cancel if component unmounts or photo changes
          });
          
          // Check if this request was cancelled before processing response
          if (isCancelled) {
            console.log('Session image load cancelled for photo:', photo.id);
            return;
          }
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const blob = await response.blob();
          
          // Double-check cancellation after async operation
          if (isCancelled) {
            URL.revokeObjectURL(URL.createObjectURL(blob)); // Clean up blob
            console.log('Session image load cancelled after blob creation for photo:', photo.id);
            return;
          }
          
          const blobUrl = URL.createObjectURL(blob);
          
          // Clean up previous blob URL
          if (fullImageBlobUrl) {
            URL.revokeObjectURL(fullImageBlobUrl);
          }
          
          setFullImageBlobUrl(blobUrl);
        } catch (error) {
          // Ignore aborted requests (expected when navigating quickly)
          if (error instanceof DOMException && error.name === 'AbortError') {
            console.log('Session image load aborted for photo:', photo.id);
            return;
          }
          
          // Only set error if this request wasn't cancelled
          if (!isCancelled) {
            console.error('Failed to load full image with session:', error);
            setImageLoading(false);
            setImageError(true);
            clearLoadingTimeout();
          }
        }
      };
      
      loadSessionImage();
      
      // Cleanup function to cancel ongoing request
      return () => {
        isCancelled = true;
        abortController.abort();
        console.log('Cancelled session image load for photo:', photo.id);
      };
    }
  }, [photo.id, isSharedView, shareToken, sessionToken]);

  // Preload nearby images for smooth navigation
  const preloadImages = useCallback((centerIndex: number) => {
    if (!photos) return;
    
    // Skip preloading for password-protected shares since they need session authentication
    // Regular img tags can't send custom headers, so they would fail with 401
    if (isSharedView && sessionToken) {
      return;
    }
    
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
        img.src = getFullImageUrl(photos[index].id);
        img.onload = () => {
          setPreloadedImages(prev => new Set([...prev, photoId]));
        };
      }
    });
  }, [photos, preloadedImages, isSharedView, sessionToken]);

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
    
    // Reset progressive loading states
    setThumbnailLoaded(false);
    setFullImageLoaded(false);
    
    // Clean up previous blob URL
    if (fullImageBlobUrl) {
      URL.revokeObjectURL(fullImageBlobUrl);
      setFullImageBlobUrl(null);
    }
    
    setLoadingWithDelay();
    
    onPhotoChange?.(newPhoto);
  }, [photos, currentIndex, onPhotoChange, setLoadingWithDelay]);

  const goToNext = useCallback(() => {
    if (!photos || currentIndex >= photos.length - 1) return;
    const newIndex = currentIndex + 1;
    const newPhoto = photos[newIndex];
    setCurrentIndex(newIndex);
    setCurrentPhoto(newPhoto);
    setCurrentFavoriteState(newPhoto.is_favorite);
    setImageLoading(true);
    setImageError(false);
    
    // Reset progressive loading states
    setThumbnailLoaded(false);
    setFullImageLoaded(false);
    
    // Clean up previous blob URL
    if (fullImageBlobUrl) {
      URL.revokeObjectURL(fullImageBlobUrl);
      setFullImageBlobUrl(null);
    }
    
    setLoadingWithDelay();
    
    onPhotoChange?.(newPhoto);
  }, [photos, currentIndex, onPhotoChange, setLoadingWithDelay]);

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

  // Handle favorite toggle (defined before keyboard navigation to avoid dependency issues)
  const handleFavoriteToggle = useCallback(async (e: React.MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Don't allow favorite toggling in shared view
    if (isSharedView || favoriteLoading) return; // Prevent multiple clicks
    
    setFavoriteLoading(true);
    const originalState = currentFavoriteState;
    
    try {
      // Trigger heart animation
      setHeartAnimating(true);
      setTimeout(() => setHeartAnimating(false), 300);
      
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
  }, [favoriteLoading, currentFavoriteState, currentPhoto.id, onFavoriteToggle]);

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
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        handleFavoriteToggle(e);
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setIsExpanded(prev => !prev);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
      
      // Clean up blob URL on unmount
      if (fullImageBlobUrl) {
        URL.revokeObjectURL(fullImageBlobUrl);
      }
    };
  }, [onClose, goToPrevious, goToNext, handleFavoriteToggle, fullImageBlobUrl]);

  const handleDownload = async () => {
    try {
      if (isSharedView && shareToken) {
        // For shared downloads, use fetch with session token then create blob URL for download
        const response = await fetch(`/api/shares/${shareToken}/download/${currentPhoto.id}`, {
          headers: sessionToken ? { 'x-share-session': sessionToken } : {}
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement("a");
        a.href = url;
        a.download = currentPhoto.filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Clean up the blob URL
        URL.revokeObjectURL(url);
      } else {
        // Regular download
        const a = document.createElement("a");
        a.href = `/api/photos/${currentPhoto.id}/download`;
        a.download = currentPhoto.filename;
        a.target = "_blank";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error("[CLIENT] Download failed:", error);
      alert('Download failed. Please try again.');
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
        <div className="flex flex-col p-4 bg-black bg-opacity-50 text-white">
          {/* Top row: filename, size, and buttons */}
          <div className="flex justify-between items-start mb-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center flex-wrap gap-3">
                <h3 className="text-lg font-medium truncate">{currentPhoto.filename}</h3>
                <div className="flex items-center text-sm text-gray-300">
                  <HardDrive className="w-4 h-4 mr-1" />
                  {formatFileSize(currentPhoto.size)}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
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
                onClick={() => setIsExpanded(prev => !prev)}
                className={`p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors ${
                  isExpanded ? "bg-white bg-opacity-20" : ""
                }`}
                title={isExpanded ? "Fit to screen (E)" : "Expand image (E)"}
              >
                {isExpanded ? <Minimize2 className="w-5 h-5" /> : <Expand className="w-5 h-5" />}
              </button>

              {/* Favorite button - only show in regular view */}
              {!isSharedView && (
                <button
                  onClick={handleFavoriteToggle}
                  disabled={favoriteLoading}
                  className={`p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors relative ${
                    favoriteLoading ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                  title={favoriteLoading ? "Updating..." : currentFavoriteState ? "Remove from favorites (F)" : "Add to favorites (F)"}
                >
                  {favoriteLoading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Heart
                      className={`w-5 h-5 transition-all duration-300 ease-out ${
                        currentFavoriteState
                          ? "text-red-500 fill-current"
                          : "text-white hover:text-red-400"
                      } ${
                        heartAnimating
                          ? "transform scale-125 rotate-12"
                          : "transform scale-100 rotate-0"
                      }`}
                      style={{
                        filter: heartAnimating 
                          ? 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.6))' 
                          : 'none'
                      }}
                    />
                  )}
                </button>
              )}
              
              {/* Download button - only show if downloads are allowed */}
              {allowDownload && (
                <button
                  onClick={handleDownload}
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
          </div>

          {/* Full width breadcrumb row */}
          <div className="w-full">
            
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
          {showLoading && !thumbnailLoaded && !fullImageLoaded && (
            <div className="absolute inset-4 bg-gray-800 rounded-lg flex items-center justify-center">
              <div className="w-16 h-16 border-4 border-gray-600 border-t-white rounded-full animate-spin"></div>
            </div>
          )}

          {/* Error state */}
          {imageError && (
            <div className="absolute inset-0 flex items-center justify-center">
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
            </div>
          )}

          {/* Navigation hints */}
          {photos && photos.length > 1 && (thumbnailLoaded || fullImageLoaded) && !imageError && (
            <>
              {/* Previous photo hint */}
              {currentIndex > 0 && (
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
              {currentIndex < photos.length - 1 && (
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

          {/* Progressive Loading Images */}
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Thumbnail - loads first and shows immediately, sized to match final image */}
            <img
              src={getThumbnailUrl(currentPhoto.id)}
              alt={`${currentPhoto.filename} thumbnail`}
              className={`absolute transition-all duration-500 ${
                isExpanded
                  ? "max-w-none max-h-none object-contain" 
                  : "max-w-full max-h-full object-contain"
              } ${
                thumbnailLoaded && !fullImageLoaded ? "opacity-100" : "opacity-0"
              } ${
                fullImageLoaded ? "scale-110 blur-sm" : "scale-100 blur-0"
              }`}
              style={{
                imageRendering: 'auto',
                width: isExpanded ? '90vw' : '100%',
                height: isExpanded ? '90vh' : '100%',
                maxWidth: isExpanded ? '90vw' : '100%',
                maxHeight: isExpanded ? '90vh' : '100%',
                objectFit: 'contain',
              }}
              loading="eager"
              onLoad={() => {
                setThumbnailLoaded(true);
                // Clear loading timeout when thumbnail loads
                clearLoadingTimeout();
              }}
              onError={() => {
                // For shared views, silently handle thumbnail errors and proceed to full image
                if (isSharedView) {
                  setThumbnailLoaded(false);
                  clearLoadingTimeout();
                } else {
                  console.log('Thumbnail load error for:', currentPhoto.filename);
                }
              }}
            />
            
            {/* Full Resolution Image - loads in background, sized to match thumbnail */}
            <img
              src={
                // For password-protected shares, don't load until blob URL is ready
                // This prevents the img tag from failing before session authentication
                isSharedView && sessionToken && !fullImageBlobUrl 
                  ? '' // Empty src prevents loading attempt
                  : (fullImageBlobUrl || getFullImageUrl(currentPhoto.id))
              }
              alt={currentPhoto.filename}
              className={`transition-all duration-500 ${
                isExpanded
                  ? "max-w-none max-h-none object-contain" 
                  : "max-w-full max-h-full object-contain"
              } ${
                fullImageLoaded ? "opacity-100" : "opacity-0"
              }`}
              style={{
                imageRendering: isExpanded ? 'crisp-edges' : 'auto',
                width: isExpanded ? '90vw' : '100%',
                height: isExpanded ? '90vh' : '100%',
                maxWidth: isExpanded ? '90vw' : '100%',
                maxHeight: isExpanded ? '90vh' : '100%',
                objectFit: 'contain',
              }}
              loading="eager"
              onLoad={() => {
                // Handle onLoad for regular image loading:
                // 1. Non-shared views (always)
                // 2. Shared views without passwords (no session needed)
                // 3. Password-protected shares using blob URLs (after session loading completes)
                const isPasswordProtectedShare = isSharedView && sessionToken;
                const isUsingBlobUrl = fullImageBlobUrl !== null;
                
                if (!isPasswordProtectedShare || isUsingBlobUrl) {
                  setImageLoading(false);
                  setFullImageLoaded(true);
                  clearLoadingTimeout();
                }
              }}
              onError={(e) => {
                // Only show error if this is not a password-protected share waiting for blob URL
                const isWaitingForSessionLoad = isSharedView && sessionToken && !fullImageBlobUrl;
                
                if (!isWaitingForSessionLoad) {
                  console.log('PhotoViewer full image error:', {
                    filename: currentPhoto.filename,
                    src: e.currentTarget.src,
                    naturalWidth: e.currentTarget.naturalWidth,
                    naturalHeight: e.currentTarget.naturalHeight,
                    isSharedView: isSharedView,
                    sessionToken: !!sessionToken,
                    fullImageBlobUrl: !!fullImageBlobUrl
                  });
                  
                  // Add a small delay before showing error to avoid flash
                  setTimeout(() => {
                    setImageLoading(false);
                    setImageError(true);
                    clearLoadingTimeout();
                  }, 100);
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
