"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Heart, Search, FolderOpen, Gauge, BarChart3, Sparkles, Loader2, Share2 } from "lucide-react";
import BlazeIcon from "@/components/BlazeIcon";
import GitHubIcon from "@/components/GitHubIcon";
import SearchBar from "@/components/SearchBar";
import AuthButton from "@/components/auth/AuthButton";
import { useAuth } from "@/components/auth/AuthProvider";

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
  const [authEnabled, setAuthEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { isAuthenticated, user, loading: authLoading } = useAuth();

  // Check auth config on client side only
  useEffect(() => {
    setMounted(true);
    
    // Fetch auth config from the client side
    const checkAuthConfig = async () => {
      try {
        const response = await fetch('/api/auth/config');
        if (response.ok) {
          const { enabled } = await response.json();
          setAuthEnabled(enabled);
        }
      } catch (error) {
        console.warn('Failed to check auth config:', error);
        setAuthEnabled(false);
      }
    };
    
    checkAuthConfig();
  }, []);

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

  // Helper function to determine if navigation should be shown
  const shouldShowNavigation = () => {
    // Don't show anything until mounted and auth check is complete
    if (!mounted || authLoading) return false;
    
    // If auth is disabled, show everything
    if (!authEnabled) return true;
    
    // If auth is enabled, only show if user is authenticated
    return isAuthenticated;
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
              {/* Search Bar - positioned first when available */}
              {shouldShowNavigation() && (
                <div className="relative mr-2">
                  <SearchBar placeholder="Search photos..." />
                </div>
              )}

              {/* Show navigation items based on auth state */}
              {shouldShowNavigation() && (
                <>

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
                </>
              )}
              
              {/* GitHub Link - always visible */}
              <a
                href="https://github.com/sderosiaux/blaze-gallery"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
                title="View source code and give us a ⭐ on GitHub"
              >
                <GitHubIcon size={20} />
              </a>

              {/* Authentication - only show if enabled and mounted to prevent hydration mismatch */}
              {mounted && authEnabled && (
                <AuthButton />
              )}
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
