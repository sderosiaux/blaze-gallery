"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Photo } from "@/types";
import PhotoGrid from "@/components/PhotoGrid";
import {
  Lock,
  Eye,
  Download,
  Calendar,
  User,
  AlertCircle,
  Share2,
  Folder,
} from "lucide-react";

interface SharedFolder {
  id: number;
  folder_path: string;
  share_token: string;
  expires_at: string | null;
  description: string | null;
  view_count: number;
  allow_download: boolean;
  created_at: string;
  created_by: string;
  has_password: boolean;
}

interface ShareData {
  share: SharedFolder;
  folder: {
    name: string;
    path: string;
    photo_count: number;
  };
  photos: Photo[];
}

export default function SharePage() {
  const params = useParams();
  const token = params.token as string;

  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  // Helper functions for localStorage session management
  const getStoredSessionToken = (shareToken: string): string | null => {
    if (typeof window === "undefined") return null;
    try {
      const stored = localStorage.getItem(`share_session_${shareToken}`);
      if (!stored) return null;

      const { token, expiresAt } = JSON.parse(stored);
      if (Date.now() > expiresAt) {
        localStorage.removeItem(`share_session_${shareToken}`);
        return null;
      }
      return token;
    } catch {
      return null;
    }
  };

  const storeSessionToken = (shareToken: string, sessionToken: string) => {
    if (typeof window === "undefined") return;
    try {
      // Store session token with 24 hour expiration
      const data = {
        token: sessionToken,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };
      localStorage.setItem(`share_session_${shareToken}`, JSON.stringify(data));
    } catch {
      // Ignore localStorage errors
    }
  };

  const removeStoredSessionToken = (shareToken: string) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.removeItem(`share_session_${shareToken}`);
    } catch {
      // Ignore localStorage errors
    }
  };

  useEffect(() => {
    if (token) {
      loadShare();
    }
  }, [token]);

  const loadShare = async (sharePassword?: string) => {
    try {
      setLoading(true);
      setError(null);

      // First, check for stored session token
      const storedSessionToken = getStoredSessionToken(token);

      const url = new URL(`/api/shares/${token}`, window.location.origin);
      if (sharePassword) {
        url.searchParams.set("password", sharePassword);
      }

      const response = await fetch(url);
      const data = await response.json();

      if (response.status === 401 && data.requires_password) {
        // If we have a stored session token, try to validate it
        if (storedSessionToken) {
          try {
            const sessionResponse = await fetch(`/api/shares/${token}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-share-session": storedSessionToken,
              },
              body: JSON.stringify({
                action: "validate_session",
              }),
            });

            if (sessionResponse.ok) {
              const sessionResult = await sessionResponse.json();
              if (sessionResult.success) {
                // Session is valid, use the stored data
                setSessionToken(storedSessionToken);
                setShareData(sessionResult.data);
                setPasswordRequired(false);
                document.title = `${sessionResult.data.folder.name} - Shared Photos`;
                setLoading(false);
                return;
              }
            }
            // If session validation failed, remove the invalid token
            removeStoredSessionToken(token);
          } catch {
            // If session validation failed, remove the invalid token
            removeStoredSessionToken(token);
          }
        }

        setPasswordRequired(true);
        setLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || "Failed to load shared folder");
      }

      setShareData(data);
      setPasswordRequired(false);

      // Update page title
      document.title = `${data.folder.name} - Shared Folder`;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load shared folder",
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setPasswordLoading(true);

    try {
      const response = await fetch(`/api/shares/${token}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "validate_password",
          password: password.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to validate password");
      }

      if (result.success) {
        // Password validated and session created
        const sessionToken = result.data.session_token;

        // Store session token in localStorage for persistence
        storeSessionToken(token, sessionToken);

        setSessionToken(sessionToken);
        setShareData(result.data);
        setPasswordRequired(false);
        document.title = `${result.data.folder.name} - Shared Photos`;
      } else {
        setError(result.error || "Invalid password");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Password validation failed",
      );
    } finally {
      setPasswordLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    const sizes = ["Bytes", "KB", "MB", "GB"];
    if (bytes === 0) return "0 Bytes";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-gray-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading shared folder...</p>
        </div>
      </div>
    );
  }

  if (passwordRequired) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              Password Required
            </h1>
            <p className="text-gray-600 mt-2">
              This photo collection is password protected. Please enter the
              password to view the photos.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter password"
                  autoComplete="current-password"
                  disabled={passwordLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <Eye className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={!password.trim() || passwordLoading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {passwordLoading ? (
                <div className="flex items-center justify-center">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                  Verifying...
                </div>
              ) : (
                "Access Photos"
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6 text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            Share Not Available
          </h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <p className="text-sm text-gray-500">
            The shared folder may have been removed or expired. Please contact
            the person who shared this link.
          </p>
        </div>
      </div>
    );
  }

  if (!shareData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Share2 className="w-8 h-8 text-blue-600 mr-3" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                  <Folder className="w-6 h-6 mr-2" />
                  {shareData.folder.name}
                </h1>
                <p className="text-gray-600 mt-1">
                  {shareData.photos.length} photos • Shared folder
                </p>
              </div>
            </div>

            {/* Share info */}
            <div className="hidden md:flex items-center space-x-6 text-sm text-gray-500">
              <div className="flex items-center">
                <Eye className="w-4 h-4 mr-1" />
                {shareData.share.view_count} views
              </div>
              <div className="flex items-center">
                <User className="w-4 h-4 mr-1" />
                {shareData.share.created_by}
              </div>
              <div className="flex items-center">
                <Calendar className="w-4 h-4 mr-1" />
                {new Date(shareData.share.created_at).toLocaleDateString()}
              </div>
              {shareData.share.expires_at && (
                <div className="flex items-center text-orange-600">
                  <Calendar className="w-4 h-4 mr-1" />
                  Expires{" "}
                  {new Date(shareData.share.expires_at).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          {shareData.share.description && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
              <p className="text-gray-700">{shareData.share.description}</p>
            </div>
          )}
        </div>
      </div>

      {/* Photo Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {shareData.photos.length > 0 ? (
          <PhotoGrid
            photos={shareData.photos}
            loading={false}
            selectedPhotoId={null}
            onPhotoUrlChange={() => {}}
            isSharedView={true}
            shareToken={token}
            allowDownload={shareData.share.allow_download}
            sessionToken={sessionToken || undefined}
          />
        ) : (
          <div className="text-center py-12">
            <Folder className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No Photos
            </h3>
            <p className="text-gray-500">
              This folder does not contain any photos.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
