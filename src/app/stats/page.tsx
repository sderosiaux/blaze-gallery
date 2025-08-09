"use client";

import { useState, useEffect } from 'react';
import { BarChart3, Camera, Database, Folder, HardDrive, Image, TrendingUp, Calendar, Eye, Zap } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import FolderHeatmap from '@/components/FolderHeatmap';
import { GalleryStats } from '@/types/stats';

export default function StatsPage() {
  const [stats, setStats] = useState<GalleryStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const response = await fetch('/api/stats');
      if (response.ok) {
        const data = await response.json();
        setStats(data.data);
      }
    } catch (error) {
      console.error('Failed to load statistics:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <AppLayout title="Blaze Gallery">
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      </AppLayout>
    );
  }

  if (!stats) {
    return (
      <AppLayout title="Blaze Gallery">
        <div className="text-center py-12">
          <p className="text-gray-500">Failed to load statistics</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Blaze Gallery">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <BarChart3 className="w-6 h-6 mr-2" />
            Gallery Statistics
          </h1>
          <div className="text-sm text-gray-500">
            Updated: {new Date(stats.generated_at).toLocaleString()}
          </div>
        </div>

        {/* Basic Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <Image className="w-8 h-8 text-blue-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Photos</p>
                <p className="text-2xl font-bold text-gray-900">{stats.basic.total_photos.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <HardDrive className="w-8 h-8 text-green-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Storage</p>
                <p className="text-2xl font-bold text-gray-900">{formatBytes(stats.basic.total_storage_bytes)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <Folder className="w-8 h-8 text-purple-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Active Folders</p>
                <p className="text-2xl font-bold text-gray-900">{stats.basic.total_folders_with_photos.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <Eye className="w-8 h-8 text-red-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Favorites</p>
                <p className="text-2xl font-bold text-gray-900">{stats.basic.total_favorites.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <Database className="w-8 h-8 text-orange-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Avg Photo Size</p>
                <p className="text-2xl font-bold text-gray-900">{formatBytes(stats.basic.avg_photo_size_bytes)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Most Viewed Folders */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <Eye className="w-5 h-5 mr-2" />
              Most Recently Viewed Folders
            </h2>
          </div>
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Folder</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Photos</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Visited</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {stats.most_viewed_folders.map((folder, index) => (
                    <tr key={index}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        <div className="truncate max-w-xs" title={folder.path}>
                          {folder.name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {folder.photo_count.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatBytes(folder.total_size)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {folder.last_visited ? (
                          typeof folder.days_since_visited === 'number' ? (
                            folder.days_since_visited < 1 ? 'Today' :
                            folder.days_since_visited < 2 ? 'Yesterday' :
                            `${Math.floor(folder.days_since_visited)} days ago`
                          ) : 'Recently'
                        ) : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Folder Size Heatmaps */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <HardDrive className="w-5 h-5 mr-2" />
                Folder Storage Heatmap
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Visual overview of folder sizes - darker/redder colors indicate larger storage usage
              </p>
            </div>
            <div className="p-6">
              <FolderHeatmap folders={stats.largest_folders_by_size} type="size" maxItems={20} />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Image className="w-5 h-5 mr-2" />
                Folder Photo Count Heatmap
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Visual overview of photo distribution - darker/redder colors indicate more photos
              </p>
            </div>
            <div className="p-6">
              <FolderHeatmap folders={stats.largest_folders_by_count} type="count" maxItems={20} />
            </div>
          </div>
        </div>

        {/* File Type Distribution & Top Cameras */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Image className="w-5 h-5 mr-2" />
                File Types
              </h2>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                {stats.file_types.slice(0, 8).map((type, index) => {
                  const percentage = (type.count / stats.basic.total_photos) * 100;
                  return (
                    <div key={index} className="flex justify-between items-center">
                      <div className="flex items-center">
                        <span className="text-sm font-medium text-gray-900 w-12">
                          {type.file_extension.toUpperCase()}
                        </span>
                        <div className="ml-3 flex-1 bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-600 h-2 rounded-full" 
                            style={{ width: `${Math.max(percentage, 2)}%` }}
                          ></div>
                        </div>
                      </div>
                      <div className="ml-4 text-sm text-gray-500 min-w-0 text-right">
                        <div>{type.count.toLocaleString()}</div>
                        <div className="text-xs">{percentage.toFixed(1)}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Camera className="w-5 h-5 mr-2" />
                Top Cameras
              </h2>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                {stats.top_cameras.slice(0, 8).map((camera, index) => {
                  const percentage = stats.metadata.photos_with_camera_info > 0 
                    ? (camera.photo_count / stats.metadata.photos_with_camera_info) * 100 
                    : 0;
                  return (
                    <div key={index} className="flex justify-between items-center">
                      <div className="flex items-center flex-1">
                        <span className="text-sm font-medium text-gray-900 truncate max-w-xs" title={camera.camera}>
                          {camera.camera}
                        </span>
                        <div className="ml-3 flex-1 bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-green-600 h-2 rounded-full" 
                            style={{ width: `${Math.max(percentage, 2)}%` }}
                          ></div>
                        </div>
                      </div>
                      <div className="ml-4 text-sm text-gray-500 min-w-0 text-right">
                        <div>{camera.photo_count.toLocaleString()}</div>
                        <div className="text-xs">{percentage.toFixed(1)}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Metadata & Sync Health */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Database className="w-5 h-5 mr-2" />
                Metadata Coverage
              </h2>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm">
                    <span>Photos with Metadata</span>
                    <span>{((stats.metadata.photos_with_metadata / stats.basic.total_photos) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                    <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${(stats.metadata.photos_with_metadata / stats.basic.total_photos) * 100}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm">
                    <span>Camera Information</span>
                    <span>{((stats.metadata.photos_with_camera_info / stats.basic.total_photos) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                    <div className="bg-green-600 h-2 rounded-full" style={{ width: `${(stats.metadata.photos_with_camera_info / stats.basic.total_photos) * 100}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm">
                    <span>Date Information</span>
                    <span>{((stats.metadata.photos_with_date_taken / stats.basic.total_photos) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                    <div className="bg-yellow-600 h-2 rounded-full" style={{ width: `${(stats.metadata.photos_with_date_taken / stats.basic.total_photos) * 100}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm">
                    <span>Location Data</span>
                    <span>{((stats.metadata.photos_with_location / stats.basic.total_photos) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                    <div className="bg-purple-600 h-2 rounded-full" style={{ width: `${(stats.metadata.photos_with_location / stats.basic.total_photos) * 100}%` }}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Zap className="w-5 h-5 mr-2" />
                Sync Health
              </h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{stats.sync_health.recently_synced}</div>
                  <div className="text-sm text-gray-600">Recent (24h)</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{stats.sync_health.synced_folders}</div>
                  <div className="text-sm text-gray-600">Total Synced</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{stats.sync_health.stale_folders}</div>
                  <div className="text-sm text-gray-600">Stale (7+ days)</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-600">{stats.sync_health.total_folders}</div>
                  <div className="text-sm text-gray-600">Total Folders</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}