"use client";

import { useRouter, usePathname } from "next/navigation";
import { Heart, Search, FolderOpen } from "lucide-react";
import BlazeIcon from "@/components/BlazeIcon";
import SearchBar from "@/components/SearchBar";

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function AppLayout({
  children,
  title,
}: AppLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();

  const getPageTitle = () => {
    if (title) return title;
    return "Blaze Gallery";
  };


  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <BlazeIcon size={32} className="mr-3" />
              <button
                onClick={() => router.push("/")}
                className="text-2xl font-bold text-gray-900 hover:text-primary-600 transition-colors"
              >
                {getPageTitle()}
              </button>
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
