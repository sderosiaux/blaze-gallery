import { useState, useCallback } from "react";
import { Photo } from "@/types";

/**
 * State for favorite toggle functionality
 */
export interface FavoriteState {
  isLoading: boolean;
  isFavorite: boolean;
  isAnimating: boolean;
}

/**
 * Actions to control favorite state
 */
export interface FavoriteActions {
  toggle: (
    photo: Photo,
    onSuccess?: (updatedPhoto: Photo) => void,
  ) => Promise<void>;
  setFavorite: (value: boolean) => void;
}

const ANIMATION_DURATION_MS = 300;

/**
 * Custom hook for managing photo favorite toggle with optimistic updates
 * Handles API calls, loading states, and heart animation
 */
export function useFavoriteToggle(
  initialValue: boolean,
  isSharedView: boolean = false,
): [FavoriteState, FavoriteActions] {
  const [isLoading, setIsLoading] = useState(false);
  const [isFavorite, setIsFavorite] = useState(initialValue);
  const [isAnimating, setIsAnimating] = useState(false);

  // Toggle favorite with optimistic update
  const toggle = useCallback(
    async (photo: Photo, onSuccess?: (updatedPhoto: Photo) => void) => {
      // Don't allow favorite toggling in shared view
      if (isSharedView || isLoading) return;

      setIsLoading(true);
      const originalState = isFavorite;

      try {
        // Trigger heart animation
        setIsAnimating(true);
        setTimeout(() => setIsAnimating(false), ANIMATION_DURATION_MS);

        // Optimistically update the UI
        setIsFavorite(!isFavorite);

        const response = await fetch(`/api/photos/${photo.id}/favorite`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success) {
          // Update with server state
          setIsFavorite(data.is_favorite);
          // Create updated photo for the parent callback
          const updatedPhoto = {
            ...photo,
            is_favorite: data.is_favorite,
          };
          onSuccess?.(updatedPhoto);
        } else {
          // Revert favorite state on server error
          setIsFavorite(originalState);
          console.error("Server error toggling favorite:", data.error);
        }
      } catch (error) {
        // Revert favorite state on network error
        setIsFavorite(originalState);
        console.error("Failed to toggle favorite:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, isFavorite, isSharedView],
  );

  // Direct setter for when photo changes externally
  const setFavorite = useCallback((value: boolean) => {
    setIsFavorite(value);
  }, []);

  const state: FavoriteState = {
    isLoading,
    isFavorite,
    isAnimating,
  };

  const actions: FavoriteActions = {
    toggle,
    setFavorite,
  };

  return [state, actions];
}
