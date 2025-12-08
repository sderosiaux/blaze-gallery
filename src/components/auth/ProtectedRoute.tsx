"use client";

import { ReactNode } from "react";
import { useAuth } from "./AuthProvider";

interface ProtectedRouteProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export default function ProtectedRoute({
  children,
  fallback,
}: ProtectedRouteProps) {
  const { isAuthenticated, loading, error } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="fixed inset-0 z-10"
        style={{ height: "100vh", width: "100vw" }}
      >
        {/* Alert/warning background image with CSS fallback */}
        <div className="absolute inset-0 bg-gradient-to-br from-red-600 via-orange-500 to-red-800 flex items-center justify-center">
          <div className="text-white text-center opacity-20">
            <div className="text-9xl mb-4">⚠️</div>
            <div className="text-4xl font-bold">ACCESS RESTRICTED</div>
          </div>
        </div>
        <img
          src="https://images.unsplash.com/photo-1573883430446-852b5cd97f40?w=1920&h=1080&fit=crop&crop=center"
          alt="Warning/restricted access background"
          className="absolute inset-0 w-full h-full object-cover"
          onError={(e) => {
            // Hide the image and show the gradient fallback
            e.currentTarget.style.display = "none";
          }}
        />

        {/* Stronger overlay for better text readability on warning image */}
        <div className="absolute inset-0 bg-black bg-opacity-50"></div>

        {/* Error message overlay */}
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8 text-center max-w-lg">
            <div className="space-y-4">
              <div className="text-4xl">⚠️</div>
              <h2 className="text-2xl font-bold text-red-600">
                Authentication Error
              </h2>
              <p className="text-lg text-gray-800 leading-relaxed">{error}</p>
              {(error.includes("not authorized") ||
                error.includes("not whitelisted")) && (
                <div className="mt-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                  <p className="text-sm text-yellow-800">
                    💡 <strong>Your email is not whitelisted.</strong> Only
                    specific email addresses are allowed to access this gallery.
                    Contact the administrator to request access.
                  </p>
                </div>
              )}
              <p className="text-sm text-gray-600">
                Try signing in again with the button in the top navigation bar
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <div
        className="fixed inset-0 z-10"
        style={{ height: "100vh", width: "100vw" }}
      >
        {/* Full screen background image */}
        <img
          src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&h=1080&fit=crop&crop=center"
          alt="Beautiful mountain landscape"
          className="absolute inset-0 w-full h-full object-cover"
          onError={(e) => {
            // Fallback to a different image if this fails
            e.currentTarget.src =
              "https://via.placeholder.com/1920x1080/4F46E5/FFFFFF?text=🖼️+Beautiful+Gallery";
          }}
        />

        {/* Overlay for better text readability */}
        <div className="absolute inset-0 bg-black bg-opacity-30"></div>

        {/* Text overlay box */}
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl p-8 text-center max-w-md">
            <div className="space-y-4">
              <h2 className="text-3xl font-bold text-gray-900">
                Welcome to Blaze Gallery
              </h2>
              <p className="text-lg text-gray-700">
                Sign in up top to explore the gallery ✨
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
