"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Photo } from "@/types";
import PhotoGrid from "@/components/PhotoGrid";
import { FolderOpen, Heart } from "lucide-react";
import AppLayout from "@/components/AppLayout";

function FavoritesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);

  // Get selected photo ID from URL search params
  const selectedPhotoId = searchParams.get("photo");

  // Handle photo URL changes
  const handlePhotoUrlChange = (photoId: string | null) => {
    const url = new URL(window.location.href);
    if (photoId) {
      url.searchParams.set("photo", photoId);
    } else {
      url.searchParams.delete("photo");
    }
    router.push(url.pathname + url.search, { scroll: false });
  };

  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/favorites");
      const data = await response.json();

      if (data.success) {
        setPhotos(data.photos || []);
      } else {
        console.error("Failed to load favorites:", data.error);
      }
    } catch (error) {
      console.error("[CLIENT] Failed to load favorites:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
        </div>
      ) : photos.length === 0 ? (
        <div className="text-center py-16">
          <div className="relative mx-auto w-32 h-32 mb-8">
            {/* Animated heart with sparkles */}
            <div className="absolute inset-0 animate-pulse">
              <Heart className="w-32 h-32 text-gray-200 mx-auto" />
            </div>
            <div className="absolute top-2 right-2">
              <div className="w-4 h-4 bg-yellow-300 rounded-full animate-ping"></div>
            </div>
            <div className="absolute bottom-4 left-4">
              <div className="w-2 h-2 bg-pink-300 rounded-full animate-pulse delay-300"></div>
            </div>
            <div className="absolute top-6 left-2">
              <div className="w-3 h-3 bg-blue-300 rounded-full animate-bounce delay-500"></div>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Your favorite moments await
          </h2>
          <p className="text-lg text-gray-600 mb-6 max-w-md mx-auto">
            Start building your collection of special memories by clicking the
            ❤️ icon on photos you love
          </p>

          <div className="bg-gradient-to-r from-pink-50 to-red-50 rounded-xl p-6 max-w-lg mx-auto border border-pink-100">
            <div className="flex items-center justify-center space-x-2 text-sm text-gray-700">
              <span>💡</span>
              <span>
                <strong>Tip:</strong> Favorites from all folders appear here in
                one place
              </span>
            </div>
          </div>

          <button
            onClick={() => router.push("/")}
            className="mt-8 inline-flex items-center px-6 py-3 bg-gradient-to-r from-pink-500 to-red-500 text-white font-medium rounded-lg hover:from-pink-600 hover:to-red-600 transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            <FolderOpen className="w-5 h-5 mr-2" />
            Start Exploring Photos
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">
              {photos.length} favorite photo{photos.length !== 1 ? "s" : ""}
            </h2>
          </div>
          <PhotoGrid 
            photos={photos}
            selectedPhotoId={selectedPhotoId}
            onPhotoUrlChange={handlePhotoUrlChange}
          />
        </div>
      )}
    </AppLayout>
  );
}

export default function FavoritesPage() {
  return (
    <Suspense
      fallback={
        <AppLayout>
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
          </div>
        </AppLayout>
      }
    >
      <FavoritesContent />
    </Suspense>
  );
}
