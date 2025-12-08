import { useState, useCallback, useEffect } from "react";
import { Photo } from "@/types";

/**
 * State for photo navigation in a gallery
 */
export interface PhotoNavigationState {
  currentPhoto: Photo;
  currentIndex: number;
  isSlideshow: boolean;
  preloadedIds: Set<string>;
  hasPrevious: boolean;
  hasNext: boolean;
}

/**
 * Actions to control photo navigation
 */
export interface PhotoNavigationActions {
  goToPrevious: () => Photo | null;
  goToNext: () => Photo | null;
  toggleSlideshow: () => void;
  stopSlideshow: () => void;
  markPreloaded: (photoId: string) => void;
}

const SLIDESHOW_INTERVAL_MS = 3000;

/**
 * Custom hook for managing photo navigation within a gallery
 * Handles previous/next navigation, slideshow mode, and preloading tracking
 */
export function usePhotoNavigation(
  initialPhoto: Photo,
  photos: Photo[] | undefined,
  onPhotoChange?: (photo: Photo) => void,
): [PhotoNavigationState, PhotoNavigationActions] {
  const [currentPhoto, setCurrentPhoto] = useState(initialPhoto);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSlideshow, setIsSlideshow] = useState(false);
  const [preloadedIds, setPreloadedIds] = useState<Set<string>>(new Set());

  // Calculate navigation availability
  const hasPrevious = photos ? currentIndex > 0 : false;
  const hasNext = photos ? currentIndex < photos.length - 1 : false;

  // Initialize current index based on selected photo
  useEffect(() => {
    if (photos) {
      const index = photos.findIndex((p) => p.id === initialPhoto.id);
      setCurrentIndex(index !== -1 ? index : 0);
    }
  }, [initialPhoto.id, photos]);

  // Sync current photo when initial photo changes
  useEffect(() => {
    setCurrentPhoto(initialPhoto);
  }, [initialPhoto]);

  // Navigate to previous photo
  const goToPrevious = useCallback((): Photo | null => {
    if (!photos || currentIndex <= 0) return null;

    const newIndex = currentIndex - 1;
    const newPhoto = photos[newIndex];

    setCurrentIndex(newIndex);
    setCurrentPhoto(newPhoto);
    onPhotoChange?.(newPhoto);

    return newPhoto;
  }, [photos, currentIndex, onPhotoChange]);

  // Navigate to next photo
  const goToNext = useCallback((): Photo | null => {
    if (!photos || currentIndex >= photos.length - 1) return null;

    const newIndex = currentIndex + 1;
    const newPhoto = photos[newIndex];

    setCurrentIndex(newIndex);
    setCurrentPhoto(newPhoto);
    onPhotoChange?.(newPhoto);

    return newPhoto;
  }, [photos, currentIndex, onPhotoChange]);

  // Toggle slideshow mode
  const toggleSlideshow = useCallback(() => {
    setIsSlideshow((prev) => !prev);
  }, []);

  // Stop slideshow
  const stopSlideshow = useCallback(() => {
    setIsSlideshow(false);
  }, []);

  // Mark a photo as preloaded
  const markPreloaded = useCallback((photoId: string) => {
    setPreloadedIds((prev) => new Set([...prev, photoId]));
  }, []);

  // Auto-advance for slideshow
  useEffect(() => {
    if (!isSlideshow || !photos) return;

    const interval = setInterval(() => {
      if (currentIndex < photos.length - 1) {
        goToNext();
      } else {
        setIsSlideshow(false); // Stop at the end
      }
    }, SLIDESHOW_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isSlideshow, currentIndex, photos, goToNext]);

  const state: PhotoNavigationState = {
    currentPhoto,
    currentIndex,
    isSlideshow,
    preloadedIds,
    hasPrevious,
    hasNext,
  };

  const actions: PhotoNavigationActions = {
    goToPrevious,
    goToNext,
    toggleSlideshow,
    stopSlideshow,
    markPreloaded,
  };

  return [state, actions];
}
