import { useState, useCallback, useRef, useEffect } from "react";

/**
 * State for progressive image loading with thumbnail fallback
 */
export interface ImageLoadingState {
  isLoading: boolean;
  hasError: boolean;
  showLoadingUI: boolean;
  thumbnailReady: boolean;
  fullImageReady: boolean;
  blobUrl: string | null;
}

/**
 * Actions to control image loading state
 */
export interface ImageLoadingActions {
  reset: () => void;
  setThumbnailLoaded: () => void;
  setFullImageLoaded: () => void;
  setError: () => void;
  setBlobUrl: (url: string | null) => void;
  clearLoadingTimeout: () => void;
}

const LOADING_DELAY_MS = 150;

/**
 * Custom hook for managing progressive image loading state
 * Handles thumbnail → full image loading with delayed loading indicator
 */
export function useImageLoading(photoId: number): [ImageLoadingState, ImageLoadingActions] {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [showLoadingUI, setShowLoadingUI] = useState(false);
  const [thumbnailReady, setThumbnailReady] = useState(false);
  const [fullImageReady, setFullImageReady] = useState(false);
  const [blobUrl, setBlobUrlState] = useState<string | null>(null);

  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear timeout helper
  const clearLoadingTimeout = useCallback(() => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    setShowLoadingUI(false);
  }, []);

  // Start loading with delayed UI indicator
  const startLoadingWithDelay = useCallback(() => {
    clearLoadingTimeout();
    setShowLoadingUI(false);
    loadingTimeoutRef.current = setTimeout(() => {
      setShowLoadingUI(true);
    }, LOADING_DELAY_MS);
  }, [clearLoadingTimeout]);

  // Reset all state for new image
  const reset = useCallback(() => {
    setIsLoading(true);
    setHasError(false);
    setThumbnailReady(false);
    setFullImageReady(false);

    // Clean up previous blob URL
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrlState(null);
    }

    startLoadingWithDelay();
  }, [blobUrl, startLoadingWithDelay]);

  // Mark thumbnail as loaded
  const setThumbnailLoaded = useCallback(() => {
    setThumbnailReady(true);
    clearLoadingTimeout();
  }, [clearLoadingTimeout]);

  // Mark full image as loaded
  const setFullImageLoaded = useCallback(() => {
    setIsLoading(false);
    setFullImageReady(true);
    clearLoadingTimeout();
  }, [clearLoadingTimeout]);

  // Set error state
  const setError = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
    clearLoadingTimeout();
  }, [clearLoadingTimeout]);

  // Set blob URL (for session-authenticated images)
  const setBlobUrl = useCallback((url: string | null) => {
    // Clean up previous blob URL
    if (blobUrl && url !== blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
    setBlobUrlState(url);
  }, [blobUrl]);

  // Reset when photo changes
  useEffect(() => {
    reset();

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [photoId]); // Only trigger on photo change, not on reset function change

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  const state: ImageLoadingState = {
    isLoading,
    hasError,
    showLoadingUI,
    thumbnailReady,
    fullImageReady,
    blobUrl,
  };

  const actions: ImageLoadingActions = {
    reset,
    setThumbnailLoaded,
    setFullImageLoaded,
    setError,
    setBlobUrl,
    clearLoadingTimeout,
  };

  return [state, actions];
}
