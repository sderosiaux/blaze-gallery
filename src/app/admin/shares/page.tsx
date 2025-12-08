"use client";

import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import {
  Share2,
  Eye,
  Download,
  Calendar,
  Lock,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  Plus,
  Search,
  Filter,
} from "lucide-react";
import { formatFileSize } from "@/lib/format";

interface SharedFolder {
  id: number;
  folder_path: string;
  folder_name: string;
  share_token: string;
  expires_at: string | null;
  description: string | null;
  view_count: number;
  last_accessed: string | null;
  allow_download: boolean;
  is_active: boolean;
  created_at: string;
  created_by: string;
  has_password: boolean;
}

export default function SharesManagementPage() {
  const [shares, setShares] = useState<SharedFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterActive, setFilterActive] = useState<boolean | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  useEffect(() => {
    loadShares();
  }, []);

  const loadShares = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/shares");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load shares");
      }

      setShares(data.shares || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shares");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyShareUrl = async (shareToken: string) => {
    try {
      const shareUrl = `${window.location.origin}/share/${shareToken}`;
      await navigator.clipboard.writeText(shareUrl);
      setCopiedToken(shareToken);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch (err) {
      console.error("Failed to copy share URL:", err);
    }
  };

  const handleDeactivateShare = async (shareToken: string) => {
    if (
      !confirm(
        "Are you sure you want to deactivate this share? This will make the link inaccessible.",
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/shares/${shareToken}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to deactivate share");
      }

      // Refresh the shares list
      await loadShares();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to deactivate share");
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInDays === 0) return "Today";
    if (diffInDays === 1) return "Yesterday";
    if (diffInDays < 30) return `${diffInDays} days ago`;
    if (diffInDays < 365) return `${Math.floor(diffInDays / 30)} months ago`;
    return `${Math.floor(diffInDays / 365)} years ago`;
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const filteredShares = shares.filter((share) => {
    const matchesSearch =
      !searchTerm ||
      share.folder_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      share.folder_path.toLowerCase().includes(searchTerm.toLowerCase()) ||
      share.description?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesFilter =
      filterActive === null || share.is_active === filterActive;

    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <AppLayout>
        <ProtectedRoute>
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        </ProtectedRoute>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ProtectedRoute>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                <Share2 className="w-6 h-6 mr-2" />
                Share Management
              </h1>
              <p className="text-gray-600 mt-1">
                Manage and monitor folder shares across your gallery
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search shares by folder name, path, or description"
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex items-center space-x-2">
                <Filter className="w-4 h-4 text-gray-400" />
                <select
                  value={
                    filterActive === null
                      ? "all"
                      : filterActive
                        ? "active"
                        : "inactive"
                  }
                  onChange={(e) => {
                    const value = e.target.value;
                    setFilterActive(
                      value === "all" ? null : value === "active",
                    );
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="all">All Shares</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center">
                <AlertCircle className="w-5 h-5 text-red-600 mr-2" />
                <p className="text-red-800">{error}</p>
              </div>
            </div>
          )}

          {/* Shares List */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {filteredShares.length === 0 ? (
              <div className="text-center py-12">
                <Share2 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  No Shared Folders
                </h3>
                <p className="text-gray-500 mb-4">
                  {searchTerm || filterActive !== null
                    ? "No shares match your current filters."
                    : "You haven't created any folder shares yet."}
                </p>
                {!searchTerm && filterActive === null && (
                  <p className="text-sm text-gray-400">
                    Visit any folder page and click the &quot;Share&quot; button
                    to create your first share.
                  </p>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Folder
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Security
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Activity
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredShares.map((share) => (
                      <tr key={share.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="flex items-start">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900">
                                {share.folder_name ||
                                  share.folder_path.split("/").pop()}
                              </p>
                              <p className="text-sm text-gray-500 truncate">
                                {share.folder_path}
                              </p>
                              {share.description && (
                                <p className="text-xs text-gray-400 mt-1">
                                  {share.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            <div className="flex items-center text-sm">
                              {share.has_password ? (
                                <>
                                  <Lock className="w-3 h-3 mr-1 text-green-500" />
                                  <span className="text-green-700">
                                    Password protected
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Lock className="w-3 h-3 mr-1 text-gray-400" />
                                  <span className="text-gray-500">
                                    Public access
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="flex items-center text-sm">
                              <Download className="w-3 h-3 mr-1" />
                              <span
                                className={
                                  share.allow_download
                                    ? "text-blue-600"
                                    : "text-gray-500"
                                }
                              >
                                {share.allow_download
                                  ? "Downloads enabled"
                                  : "View only"}
                              </span>
                            </div>
                            {share.expires_at && (
                              <div className="flex items-center text-sm">
                                <Calendar className="w-3 h-3 mr-1" />
                                <span
                                  className={
                                    isExpired(share.expires_at)
                                      ? "text-red-600"
                                      : "text-orange-600"
                                  }
                                >
                                  {isExpired(share.expires_at)
                                    ? "Expired"
                                    : "Expires"}{" "}
                                  {formatDate(share.expires_at)}
                                </span>
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center">
                              <Eye className="w-3 h-3 mr-1 text-blue-500" />
                              <span>{share.view_count} views</span>
                            </div>
                            {share.last_accessed && (
                              <p className="text-gray-500 text-xs">
                                Last accessed {getTimeAgo(share.last_accessed)}
                              </p>
                            )}
                            <p className="text-gray-500 text-xs">
                              Created {getTimeAgo(share.created_at)}
                            </p>
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <div
                              className={`w-2 h-2 rounded-full mr-2 ${
                                !share.is_active
                                  ? "bg-red-500"
                                  : isExpired(share.expires_at)
                                    ? "bg-orange-500"
                                    : "bg-green-500"
                              }`}
                            />
                            <span
                              className={`text-sm ${
                                !share.is_active
                                  ? "text-red-700"
                                  : isExpired(share.expires_at)
                                    ? "text-orange-700"
                                    : "text-green-700"
                              }`}
                            >
                              {!share.is_active
                                ? "Inactive"
                                : isExpired(share.expires_at)
                                  ? "Expired"
                                  : "Active"}
                            </span>
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() =>
                                handleCopyShareUrl(share.share_token)
                              }
                              className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Copy share link"
                            >
                              {copiedToken === share.share_token ? (
                                <Check className="w-4 h-4 text-green-600" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </button>

                            <button
                              onClick={() =>
                                window.open(
                                  `/share/${share.share_token}`,
                                  "_blank",
                                )
                              }
                              className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Open share"
                            >
                              <Eye className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() =>
                                handleDeactivateShare(share.share_token)
                              }
                              className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                              title="Deactivate share"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Summary Stats */}
          {shares.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center">
                  <Share2 className="w-8 h-8 text-blue-600" />
                  <div className="ml-3">
                    <p className="text-sm text-gray-500">Total Shares</p>
                    <p className="text-lg font-semibold">{shares.length}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center">
                  <Eye className="w-8 h-8 text-green-600" />
                  <div className="ml-3">
                    <p className="text-sm text-gray-500">Active Shares</p>
                    <p className="text-lg font-semibold">
                      {
                        shares.filter(
                          (s) => s.is_active && !isExpired(s.expires_at),
                        ).length
                      }
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center">
                  <Lock className="w-8 h-8 text-purple-600" />
                  <div className="ml-3">
                    <p className="text-sm text-gray-500">Protected</p>
                    <p className="text-lg font-semibold">
                      {shares.filter((s) => s.has_password).length}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center">
                  <Eye className="w-8 h-8 text-orange-600" />
                  <div className="ml-3">
                    <p className="text-sm text-gray-500">Total Views</p>
                    <p className="text-lg font-semibold">
                      {shares.reduce((sum, s) => sum + s.view_count, 0)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </ProtectedRoute>
    </AppLayout>
  );
}
