"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Photo, Folder } from "@/types";
import PhotoGrid from "@/components/PhotoGrid";
import FolderBrowser from "@/components/FolderBrowser";
import { FolderOpen, Search } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";

interface SearchResults {
  photos: Photo[];
  folders: Folder[];
  query: string;
}

function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams?.get("q") || "";
  const selectedPhotoId = searchParams?.get("photo");

  const [results, setResults] = useState<SearchResults>({
    photos: [],
    folders: [],
    query: "",
  });
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState(query);

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
    if (query) {
      setSearchInput(query);
      performSearch(query);
    }
  }, [query]);

  const performSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults({ photos: [], folders: [], query: searchQuery });
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(searchQuery)}`,
      );
      const data = await response.json();

      if (data.success) {
        setResults({
          photos: data.photos || [],
          folders: data.folders || [],
          query: data.query,
        });
      } else {
        console.error("Search failed:", data.error);
      }
    } catch (error) {
      console.error("[CLIENT] Failed to search:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedQuery = searchInput.trim();
    if (trimmedQuery) {
      router.push(`/search?q=${encodeURIComponent(trimmedQuery)}`);
    } else {
      router.push("/search");
    }
  };

  const navigateToFolder = (folderPath: string) => {
    if (folderPath === "") {
      router.push("/");
    } else {
      router.push(`/folder/${folderPath}`);
    }
  };

  return (
    <AppLayout>
      <ProtectedRoute>
        {/* Search Form */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <form onSubmit={handleSearch} className="flex gap-4">
            <div className="flex-1">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search photos by name, folder, or location..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            >
              Search
            </button>
          </form>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : !query ? (
          <div className="text-center py-12">
            <Search className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-gray-900 mb-2">
              Search your photos
            </h2>
            <p className="text-gray-500">
              Enter a search term to find photos and folders
            </p>
          </div>
        ) : results.photos.length === 0 && results.folders.length === 0 ? (
          <div className="text-center py-12">
            <Search className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-gray-900 mb-2">
              No results found
            </h2>
            <p className="text-gray-500">
              Try searching with different keywords
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Folders Results */}
            {results.folders.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">
                  Folders ({results.folders.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {results.folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => navigateToFolder(folder.path)}
                      className="flex items-center p-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-colors text-left"
                    >
                      <FolderOpen className="w-8 h-8 text-blue-500 mr-3 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 truncate">
                          {folder.name}
                        </p>
                        <p className="text-sm text-gray-500">
                          {folder.photo_count} photos
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Photos Results */}
            {results.photos.length > 0 && (
              <PhotoGrid
                photos={results.photos}
                loading={loading}
                selectedPhotoId={selectedPhotoId}
                onPhotoUrlChange={handlePhotoUrlChange}
              />
            )}
          </div>
        )}
      </ProtectedRoute>
    </AppLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
