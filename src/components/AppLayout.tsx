"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Heart, Search, FolderOpen, Gauge, BarChart3, Sparkles, Loader2, Share2 } from "lucide-react";
import BlazeIcon from "@/components/BlazeIcon";
import GitHubIcon from "@/components/GitHubIcon";
import SearchBar from "@/components/SearchBar";

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({
  children,
}: AppLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [randomFolderLoading, setRandomFolderLoading] = useState(false);

  // Track scroll position to add shadow effect
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleRandomFolder = async () => {
    setRandomFolderLoading(true);
    try {
      const response = await fetch('/api/stats/random-folder');
      const data = await response.json();
      
      if (data.success) {
        const folderPath = data.data.path === '' ? '/' : `/folder/${data.data.path}`;
        window.location.href = folderPath;
      } else {
        console.error('Failed to get random folder:', data.error);
        alert('No folders with photos found!');
      }
    } catch (error) {
      console.error('Error fetching random folder:', error);
      alert('Failed to find a random folder');
    } finally {
      setRandomFolderLoading(false);
    }
  };

  const getPageTitle = () => {
    return "Blaze Gallery";
  };


  return (
    <div className="min-h-screen bg-gray-50">
      <header className={`
        fixed top-0 left-0 right-0 z-50 bg-white border-b transition-all duration-200
        ${scrolled 
          ? 'shadow-lg backdrop-blur-sm bg-white/95' 
          : 'shadow-sm'
        }
      `}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <BlazeIcon size={32} className="mr-3" />
              <a
                href="/"
                className="text-2xl font-bold text-gray-900 hover:text-primary-600 transition-colors"
              >
                {getPageTitle()}
              </a>
            </div>
            <div className="flex items-center space-x-2">
              {/* Random Folder Button */}
              <button
                onClick={handleRandomFolder}
                disabled={randomFolderLoading}
                className="flex items-center p-2 text-gray-600 hover:text-orange-500 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Navigate to a random folder with photos"
              >
                {randomFolderLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Sparkles className="w-5 h-5" />
                )}
              </button>

              {/* Statistics Link */}
              <a
                href="/stats"
                className="flex items-center p-2 text-gray-600 hover:text-purple-500 hover:bg-gray-50 rounded-lg transition-colors"
                title="View gallery statistics"
              >
                <BarChart3 className="w-5 h-5" />
              </a>

              {/* Audit Dashboard Link */}
              <a
                href="/audit"
                className="flex items-center p-2 text-gray-600 hover:text-blue-500 hover:bg-gray-50 rounded-lg transition-colors"
                title="View B2 performance audit"
              >
                <Gauge className="w-5 h-5" />
              </a>
              
              {/* Share Management Link */}
              <a
                href="/admin/shares"
                className="flex items-center p-2 text-gray-600 hover:text-green-500 hover:bg-gray-50 rounded-lg transition-colors"
                title="Manage folder shares"
              >
                <Share2 className="w-5 h-5" />
              </a>

              {/* Favorites Link */}
              {pathname !== "/favorites" && (
                <a
                  href="/favorites"
                  className="flex items-center p-2 text-gray-600 hover:text-red-500 hover:bg-gray-50 rounded-lg transition-colors"
                  title="View your favorite photos"
                >
                  <Heart className="w-5 h-5" />
                </a>
              )}
              
              {/* GitHub Link */}
              <a
                href="https://github.com/sderosiaux/blaze-gallery"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
                title="View source code and give us a ⭐ on GitHub"
              >
                <GitHubIcon size={20} />
              </a>
              {/* Back to Folders Button (for favorites and search pages) */}
              {(pathname === "/favorites" || pathname === "/search") && (
                <button
                  onClick={() => router.push("/")}
                  className="flex items-center px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <FolderOpen className="w-5 h-5 mr-2" />
                  {pathname === "/favorites" ? "Back to Folders" : "Browse"}
                </button>
              )}

              {/* Search Bar - positioned after icons */}
              <div className="relative">
                <SearchBar placeholder="Search photos..." />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Add top padding to account for fixed header */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pt-24">
        {children}
      </main>
    </div>
  );
}
