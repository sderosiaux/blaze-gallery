"use client";

import { useRouter, usePathname } from "next/navigation";
import { Heart, Search, FolderOpen } from "lucide-react";
import BlazeIcon from "@/components/BlazeIcon";
import SearchBar from "@/components/SearchBar";

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
}

export default function AppLayout({
  children,
  title,
  subtitle,
  icon,
}: AppLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();

  const getPageTitle = () => {
    if (title) return title;

    if (pathname === "/") return "Blaze Gallery";
    if (pathname === "/favorites") return "Favorites";
    if (pathname === "/search") return "Search";
    if (pathname?.startsWith("/folder")) return "Blaze Gallery";
    return "Blaze Gallery";
  };

  const getPageIcon = () => {
    if (icon) return icon;

    if (pathname === "/favorites")
      return <Heart className="w-6 h-6 text-red-500 mr-2" />;
    if (pathname === "/search")
      return <Search className="w-6 h-6 text-blue-600 mr-2" />;
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <BlazeIcon size={32} className="mr-3" />
              <div className="flex items-center">
                <button
                  onClick={() => router.push("/")}
                  className="text-2xl font-bold text-gray-900 hover:text-primary-600 transition-colors mr-2"
                >
                  {getPageTitle()}
                </button>
                {(subtitle || getPageIcon()) && (
                  <>
                    <span className="text-gray-400 text-xl font-light mx-2">
                      /
                    </span>
                    {getPageIcon()}
                    {subtitle && (
                      <h1 className="text-2xl font-bold text-gray-900">
                        {subtitle}
                      </h1>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {/* Integrated Search Bar */}
              <div className="relative">
                <SearchBar placeholder="Search photos..." />
              </div>
              {/* Favorites Button */}
              {pathname !== "/favorites" && (
                <button
                  onClick={() => router.push("/favorites")}
                  className="flex items-center px-3 py-2 text-gray-600 hover:text-red-500 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <Heart className="w-5 h-5 mr-2" />
                  Favorites
                </button>
              )}
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
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
