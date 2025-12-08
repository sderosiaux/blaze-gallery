"use client";

import { useState, useEffect } from "react";
import {
  X,
  Share2,
  Lock,
  Calendar,
  Download,
  Copy,
  Check,
  Eye,
  EyeOff,
} from "lucide-react";

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  folderPath: string;
  folderName: string;
}

interface ShareResponse {
  success: boolean;
  share: {
    id: number;
    share_token: string;
    folder_path: string;
    expires_at: string | null;
    description: string | null;
    allow_download: boolean;
    created_at: string;
  };
  share_url: string;
}

export default function ShareDialog({
  isOpen,
  onClose,
  folderPath,
  folderName,
}: ShareDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareData, setShareData] = useState<ShareResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Form state
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [description, setDescription] = useState("");
  const [allowDownload, setAllowDownload] = useState(true);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      setShareData(null);
      setError(null);
      setPassword("");
      setExpiresAt("");
      setDescription("");
      setAllowDownload(true);
      setCopied(false);
    }
  }, [isOpen]);

  const handleCreateShare = async () => {
    if (!folderPath) return;

    setIsLoading(true);
    setError(null);

    try {
      const payload: any = {
        folder_path: folderPath,
        allow_download: allowDownload,
      };

      if (password.trim()) {
        payload.password = password.trim();
      }

      if (expiresAt) {
        payload.expires_at = new Date(expiresAt).toISOString();
      }

      if (description.trim()) {
        payload.description = description.trim();
      }

      const response = await fetch("/api/shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create share");
      }

      setShareData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!shareData?.share_url) return;

    try {
      await navigator.clipboard.writeText(shareData.share_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  };

  const getMinDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split("T")[0];
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center">
            <Share2 className="w-5 h-5 mr-2 text-blue-600" />
            <h2 className="text-lg font-semibold">Share Folder</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {!shareData ? (
            <div className="space-y-4">
              {/* Folder info */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center">
                  <span className="text-2xl mr-3">📁</span>
                  <div>
                    <h3 className="font-medium">{folderName}</h3>
                    <p className="text-sm text-gray-500">{folderPath}</p>
                  </div>
                </div>
              </div>

              {/* Error message */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-red-800 text-sm">{error}</p>
                </div>
              )}

              {/* Form fields */}
              <div className="space-y-4">
                {/* Password protection */}
                <div>
                  <label className="flex items-center text-sm font-medium text-gray-700 mb-2">
                    <Lock className="w-4 h-4 mr-1" />
                    Password Protection (optional)
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password to protect share"
                      className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expiration date */}
                <div>
                  <label className="flex items-center text-sm font-medium text-gray-700 mb-2">
                    <Calendar className="w-4 h-4 mr-1" />
                    Expiration Date (optional)
                  </label>
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    min={getMinDate()}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description (optional)
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Add a note about what you're sharing"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                </div>

                {/* Download permission */}
                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={allowDownload}
                      onChange={(e) => setAllowDownload(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <Download className="w-4 h-4 ml-2 mr-1" />
                    <span className="text-sm text-gray-700">
                      Allow file downloads
                    </span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1 ml-6">
                    Recipients can save original photos to their device. They
                    can always view and browse photos.
                  </p>
                </div>
              </div>

              {/* Create button */}
              <button
                onClick={handleCreateShare}
                disabled={isLoading}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? (
                  <div className="flex items-center justify-center">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    Creating Share...
                  </div>
                ) : (
                  "Create Share Link"
                )}
              </button>
            </div>
          ) : (
            /* Share created successfully */
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Check className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Share Link Created!
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  Anyone with this link can access the folder
                </p>
              </div>

              {/* Share URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Share Link
                </label>
                <div className="flex">
                  <input
                    type="text"
                    value={shareData.share_url}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-l-lg bg-gray-50 text-sm"
                  />
                  <button
                    onClick={handleCopyUrl}
                    className="px-4 py-2 bg-blue-600 text-white border border-blue-600 rounded-r-lg hover:bg-blue-700 transition-colors"
                    title="Copy link"
                  >
                    {copied ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Share details */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Folder:</span>
                  <span className="font-medium">{folderName}</span>
                </div>
                {shareData.share.description && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Description:</span>
                    <span className="font-medium">
                      {shareData.share.description}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Password:</span>
                  <span className="font-medium">
                    {password ? "Protected" : "None"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Downloads:</span>
                  <span className="font-medium">
                    {shareData.share.allow_download ? "Allowed" : "Disabled"}
                  </span>
                </div>
                {shareData.share.expires_at && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Expires:</span>
                    <span className="font-medium">
                      {new Date(
                        shareData.share.expires_at,
                      ).toLocaleDateString()}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Created:</span>
                  <span className="font-medium">
                    {new Date(shareData.share.created_at).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex space-x-2">
                <button
                  onClick={() => window.open(shareData.share_url, "_blank")}
                  className="flex-1 bg-gray-100 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Preview Share
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
