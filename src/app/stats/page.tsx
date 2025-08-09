"use client";

import { useState, useEffect } from 'react';
import { BarChart3, Camera, Database, Folder, HardDrive, Image, TrendingUp, Calendar, Eye, Zap, Copy, AlertTriangle } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import FolderHeatmap from '@/components/FolderHeatmap';
import { GalleryStats } from '@/types/stats';

interface DuplicatePhoto {
  id: number;
  s3_key: string;
  size: number;
  folder_path: string;
  created_at: string;
}

interface DuplicateGroup {
  filename: string;
  count: number;
  photos: DuplicatePhoto[];
}

interface DuplicateStats {
  summary: {
    total_duplicate_filenames: number;
    total_duplicate_photos: number;
    potential_space_saved_bytes: number;
  };
  duplicates: DuplicateGroup[];
}

interface IgnoredFilesStats {
  summary: {
    total_ignored_files: number;
    total_ignored_size_bytes: number;
    categories: {
      synology_thumbnails: number;
      system_files: number;
      small_files: number;
      eadir_folders: number;
    };
  };
  breakdown: {
    category: string;
    count: number;
    total_size_bytes: number;
    examples: string[];
  }[];
}

interface DuplicateFoldersStats {
  summary: {
    total_duplicate_folder_groups: number;
    total_duplicate_folders: number;
    potential_space_saved_bytes: number;
  };
  duplicates: {
    folder_signature: string;
    count: number;
    file_count: number;
    total_size_bytes: number;
    folders: {
      id: number;
      path: string;
      name: string;
      photo_count: number;
      total_size_bytes: number;
    }[];
  }[];
}

export default function StatsPage() {
  const [stats, setStats] = useState<GalleryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('overview');
  const [duplicates, setDuplicates] = useState<DuplicateStats | null>(null);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [ignoredFiles, setIgnoredFiles] = useState<IgnoredFilesStats | null>(null);
  const [ignoredFilesLoading, setIgnoredFilesLoading] = useState(false);
  const [duplicateFolders, setDuplicateFolders] = useState<DuplicateFoldersStats | null>(null);
  const [duplicateFoldersLoading, setDuplicateFoldersLoading] = useState(false);

  useEffect(() => {
    loadStats();
    loadDuplicates();
    loadIgnoredFiles();
    loadDuplicateFolders();
  }, []);

  // Track which section is currently visible using scroll position
  useEffect(() => {
    const handleScroll = () => {
      const sections = ['overview', 'activity', 'storage', 'content', 'duplicates', 'ignored', 'system'];
      const scrollTop = window.scrollY + 150; // Offset for fixed header
      
      let currentSection = 'overview';
      
      for (const sectionId of sections) {
        const element = document.getElementById(sectionId);
        if (element) {
          const rect = element.getBoundingClientRect();
          const elementTop = rect.top + window.scrollY;
          
          if (scrollTop >= elementTop) {
            currentSection = sectionId;
          }
        }
      }
      
      setActiveSection(currentSection);
    };

    // Initial check
    handleScroll();
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [stats]);

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

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      const headerOffset = 120; // Account for fixed header
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
      
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  };

  const loadDuplicates = async () => {
    setDuplicatesLoading(true);
    try {
      const response = await fetch('/api/stats/duplicates');
      if (response.ok) {
        const data = await response.json();
        setDuplicates(data.data);
      }
    } catch (error) {
      console.error('Failed to load duplicates:', error);
    } finally {
      setDuplicatesLoading(false);
    }
  };

  const loadIgnoredFiles = async () => {
    setIgnoredFilesLoading(true);
    try {
      const response = await fetch('/api/stats/ignored-files');
      if (response.ok) {
        const data = await response.json();
        setIgnoredFiles(data.data);
      }
    } catch (error) {
      console.error('Failed to load ignored files:', error);
    } finally {
      setIgnoredFilesLoading(false);
    }
  };

  const loadDuplicateFolders = async () => {
    setDuplicateFoldersLoading(true);
    try {
      const response = await fetch('/api/stats/duplicate-folders');
      if (response.ok) {
        const data = await response.json();
        setDuplicateFolders(data.data);
      }
    } catch (error) {
      console.error('Failed to load duplicate folders:', error);
    } finally {
      setDuplicateFoldersLoading(false);
    }
  };

  const navigationItems = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'activity', label: 'Activity', icon: '👁️' },
    { id: 'storage', label: 'Storage', icon: '🗂️' },
    { id: 'content', label: 'Content', icon: '📷' },
    { id: 'duplicates', label: 'Duplicates', icon: '🔍' },
    { id: 'ignored', label: 'Ignored Files', icon: '🚫' },
    { id: 'system', label: 'System', icon: '⚙️' },
  ];

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
      {/* Floating Navigation Menu */}
      <div className="fixed left-[calc(50%-32rem-20rem)] top-32 z-30 hidden xl:block">
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-2">
          <nav className="space-y-1">
            {navigationItems.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={`
                  w-full flex items-center px-3 py-2 text-sm rounded-lg transition-all duration-200
                  ${activeSection === item.id 
                    ? 'bg-blue-50 text-blue-700 shadow-sm border border-blue-200' 
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }
                `}
                title={`Go to ${item.label} section`}
              >
                <span className="text-base mr-2">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="space-y-8">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <BarChart3 className="w-6 h-6 mr-2" />
            Gallery Statistics
          </h1>
        </div>

        {/* Overview Section */}
        <section id="overview" className="space-y-4 scroll-mt-24">
          <h2 className="text-xl font-semibold text-gray-800 border-b-2 border-gray-200 pb-2">
            📊 Gallery Overview
          </h2>
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
        </section>

        {/* Folder Activity Section */}
        <section id="activity" className="space-y-4 scroll-mt-24">
          <h2 className="text-xl font-semibold text-gray-800 border-b-2 border-gray-200 pb-2">
            👁️ Recent Activity
          </h2>
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <Eye className="w-5 h-5 mr-2" />
                Most Recently Viewed Folders
              </h3>
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
                          <a 
                            href={folder.path === '' ? '/' : `/folder/${folder.path}`}
                            className="text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                          >
                            {folder.name || 'Root'}
                          </a>
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
        </section>

        {/* Storage Analysis Section */}
        <section id="storage" className="space-y-6 scroll-mt-24">
          <h2 className="text-xl font-semibold text-gray-800 border-b-2 border-gray-200 pb-2">
            🗂️ Storage & Distribution Analysis
          </h2>
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <HardDrive className="w-5 h-5 mr-2" />
                Folder Storage Heatmap
              </h3>
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
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <Image className="w-5 h-5 mr-2" />
                Folder Photo Count Heatmap
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                Visual overview of photo distribution - darker/redder colors indicate more photos
              </p>
            </div>
            <div className="p-6">
              <FolderHeatmap folders={stats.largest_folders_by_count} type="count" maxItems={20} />
            </div>
          </div>
        </div>
        </section>

        {/* Content Analysis Section */}
        <section id="content" className="space-y-6 scroll-mt-24">
          <h2 className="text-xl font-semibold text-gray-800 border-b-2 border-gray-200 pb-2">
            📷 Content Analysis
          </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <Image className="w-5 h-5 mr-2" />
                File Types
              </h3>
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
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <Camera className="w-5 h-5 mr-2" />
                Top Cameras
              </h3>
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
        </section>

        {/* Duplicates Section */}
        <section id="duplicates" className="space-y-6 scroll-mt-24">
          <h2 className="text-xl font-semibold text-gray-800 border-b-2 border-gray-200 pb-2">
            🔍 Duplicates Detection
          </h2>

          {/* All KPIs Combined */}
          {(duplicates || duplicateFolders) && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              <div className="bg-white rounded-lg shadow p-6">
                <div className="text-center">
                  <AlertTriangle className="w-8 h-8 text-yellow-600 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-600 mb-1">Duplicate Files</p>
                  <p className="text-2xl font-bold text-gray-900">{duplicates?.summary.total_duplicate_filenames || 0}</p>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="text-center">
                  <Copy className="w-8 h-8 text-red-600 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-600 mb-1">Duplicate Photos</p>
                  <p className="text-2xl font-bold text-gray-900">{duplicates?.summary.total_duplicate_photos || 0}</p>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="text-center">
                  <Folder className="w-8 h-8 text-purple-600 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-600 mb-1">Duplicate Folders</p>
                  <p className="text-2xl font-bold text-gray-900">{duplicateFolders?.summary.total_duplicate_folder_groups || 0}</p>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="text-center">
                  <Copy className="w-8 h-8 text-orange-600 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-600 mb-1">Total Folders</p>
                  <p className="text-2xl font-bold text-gray-900">{duplicateFolders?.summary.total_duplicate_folders || 0}</p>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="text-center">
                  <HardDrive className="w-8 h-8 text-green-600 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-600 mb-1">Files Space Saved</p>
                  <p className="text-2xl font-bold text-gray-900">{formatBytes(duplicates?.summary.potential_space_saved_bytes || 0)}</p>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="text-center">
                  <HardDrive className="w-8 h-8 text-blue-600 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-600 mb-1">Folders Space Saved</p>
                  <p className="text-2xl font-bold text-gray-900">{formatBytes(duplicateFolders?.summary.potential_space_saved_bytes || 0)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Loading States */}
          {(duplicatesLoading || duplicateFoldersLoading) && (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Analyzing Duplicates...</h3>
              <p className="text-gray-500">
                Scanning your gallery for duplicate files and folders.
              </p>
            </div>
          )}

          {/* Duplicate Files List */}
          {duplicates && !duplicatesLoading && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                <Image className="w-5 h-5 mr-2" />
                Duplicate Files
              </h3>
              {duplicates.duplicates.length > 0 ? (
                <div className="bg-white rounded-lg shadow">
                  <div className="p-6">
                    <div className="space-y-6">

                      {duplicates.duplicates.slice(0, 10).map((group, index) => (
                        <div key={index} className="border-l-4 border-yellow-400 pl-4">
                          <div className="flex justify-between items-start mb-3">
                            <h4 className="font-medium text-gray-900">
                              {group.filename} <span className="text-gray-500">({formatBytes(group.photos[0].size)})</span>
                            </h4>
                            <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">
                              {group.count} copies
                            </span>
                          </div>
                          <div className="space-y-2">
                            {group.photos.map((photo) => (
                              <div key={photo.id} className="flex justify-between items-center text-sm bg-gray-50 p-3 rounded">
                                <div className="flex-1">
                                  <a 
                                    href={photo.folder_path === '' ? '/' : `/folder/${photo.folder_path}`}
                                    className="text-blue-600 hover:text-blue-800 hover:underline"
                                  >
                                    📁 {photo.folder_path || '/'}
                                  </a>
                                </div>
                                <div className="text-gray-500 text-xs ml-4">
                                  {formatBytes(photo.size)} • {new Date(photo.created_at).toLocaleDateString()}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {duplicates.duplicates.length > 10 && (
                        <div className="text-center py-4 text-gray-500">
                          ... and {duplicates.duplicates.length - 10} more duplicate file groups
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
                  <div className="text-green-600 mb-2">
                    <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p>No duplicate files found</p>
                </div>
              )}
            </div>
          )}

          {/* Duplicate Folders List */}
          {duplicateFolders && !duplicateFoldersLoading && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                <Folder className="w-5 h-5 mr-2" />
                Duplicate Folders
              </h3>
              {duplicateFolders.duplicates.length > 0 ? (
                <div className="bg-white rounded-lg shadow">
                  <div className="p-6">
                    <div className="space-y-6">
                      {duplicateFolders.duplicates.slice(0, 10).map((group, index) => (
                        <div key={index} className="border-l-4 border-purple-400 pl-4">
                          <div className="flex justify-between items-start mb-3">
                            <h4 className="font-medium text-gray-900">
                              {group.file_count} files <span className="text-gray-500">({formatBytes(group.total_size_bytes)})</span>
                            </h4>
                            <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">
                              {group.count} copies
                            </span>
                          </div>
                          <div className="space-y-2">
                            {group.folders.map((folder) => (
                              <div key={folder.id} className="flex justify-between items-center text-sm bg-gray-50 p-3 rounded">
                                <div className="flex-1">
                                  <a 
                                    href={folder.path === '' ? '/' : `/folder/${folder.path}`}
                                    className="text-blue-600 hover:text-blue-800 hover:underline"
                                  >
                                    📁 {folder.path || '/'}
                                  </a>
                                </div>
                                <div className="text-gray-500 text-xs ml-4">
                                  {folder.photo_count} files • {formatBytes(folder.total_size_bytes)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {duplicateFolders.duplicates.length > 10 && (
                        <div className="text-center py-4 text-gray-500">
                          ... and {duplicateFolders.duplicates.length - 10} more duplicate folder groups
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
                  <div className="text-green-600 mb-2">
                    <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p>No duplicate folders found</p>
                </div>
              )}
            </div>
          )}

          {/* Info Box */}
          {(duplicates || duplicateFolders) && (
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="flex">
                <div className="text-blue-600 mr-3">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="text-sm">
                  <h4 className="text-blue-800 font-medium mb-1">How are duplicates detected?</h4>
                  <p className="text-blue-700">
                    Files are identified as duplicates when they have identical names and sizes. 
                    Folders are considered duplicates when they contain the exact same set of files. 
                    System files and thumbnails are automatically excluded from detection.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Ignored Files Section */}
        <section id="ignored" className="space-y-6 scroll-mt-24">
          <h2 className="text-xl font-semibold text-gray-800 border-b-2 border-gray-200 pb-2">
            🚫 Ignored Files
          </h2>
          
          {ignoredFilesLoading && (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Analyzing Ignored Files...</h3>
              <p className="text-gray-500">
                Scanning for system files and thumbnails that are excluded from duplicate detection.
              </p>
            </div>
          )}

          {ignoredFiles && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center">
                    <AlertTriangle className="w-8 h-8 text-orange-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">Total Ignored Files</p>
                      <p className="text-2xl font-bold text-gray-900">{ignoredFiles.summary.total_ignored_files.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center">
                    <HardDrive className="w-8 h-8 text-purple-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">Space Used by Ignored Files</p>
                      <p className="text-2xl font-bold text-gray-900">{formatBytes(ignoredFiles.summary.total_ignored_size_bytes)}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Breakdown */}
              {ignoredFiles.breakdown.length > 0 && (
                <div className="bg-white rounded-lg shadow">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Breakdown by Category
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Files excluded from duplicate detection and gallery display
                    </p>
                  </div>
                  <div className="p-6">
                    <div className="space-y-6">
                      {ignoredFiles.breakdown.map((category, index) => (
                        <div key={index} className="border-l-4 border-orange-400 pl-4">
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-medium text-gray-900">{category.category}</h4>
                            <div className="text-right text-sm text-gray-500">
                              <div>{category.count.toLocaleString()} files</div>
                              <div>{formatBytes(category.total_size_bytes)}</div>
                            </div>
                          </div>
                          {category.examples.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs text-gray-600 mb-1">Examples:</p>
                              <div className="space-y-1">
                                {category.examples.map((example, i) => (
                                  <div key={i} className="text-xs font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded truncate">
                                    {example}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Info Box */}
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="flex">
                  <div className="text-blue-600 mr-3">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="text-sm">
                    <h4 className="text-blue-800 font-medium mb-1">Why are files ignored?</h4>
                    <p className="text-blue-700">
                      These files are automatically excluded from duplicate detection to focus on actual photo duplicates. 
                      This includes system thumbnails, metadata files, and very small files that are likely not photos.
                      Future updates may include cleanup options for these files.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>

        {/* System Health Section */}
        <section id="system" className="space-y-6 scroll-mt-24">
          <h2 className="text-xl font-semibold text-gray-800 border-b-2 border-gray-200 pb-2">
            ⚙️ System Health & Metadata
          </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <Database className="w-5 h-5 mr-2" />
                Metadata Coverage
              </h3>
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
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <Zap className="w-5 h-5 mr-2" />
                Sync Health
              </h3>
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
        </section>
      </div>
    </AppLayout>
  );
}