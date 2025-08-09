"use client";

import { useState } from "react";
import { Folder } from "@/types";
import { Folder as FolderIcon, FolderCheck, ChevronRight, Share2 } from "lucide-react";
import FolderTooltip from "./FolderTooltip";
import ShareDialog from "./ShareDialog";
import Link from "next/link";

interface BreadcrumbItem {
  name: string;
  path: string;
}

interface FolderBrowserProps {
  currentFolder: Folder | null;
  folders: Folder[];
  breadcrumbs: BreadcrumbItem[];
  onFolderSelect: (folderPath: string) => void;
  onBreadcrumbClick: (path: string) => void;
}

export default function FolderBrowser({
  currentFolder,
  folders,
  breadcrumbs,
  onFolderSelect,
  onBreadcrumbClick,
}: FolderBrowserProps) {
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  
  // Get current folder path for sharing
  const getCurrentFolderPath = () => {
    if (breadcrumbs.length === 0) return "";
    const lastBreadcrumb = breadcrumbs[breadcrumbs.length - 1];
    return lastBreadcrumb.path;
  };

  const getCurrentFolderName = () => {
    if (breadcrumbs.length === 0) return "";
    const lastBreadcrumb = breadcrumbs[breadcrumbs.length - 1];
    return lastBreadcrumb.name;
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      {/* Breadcrumb Navigation with Share Button */}
      <div className="mb-4 flex items-center justify-between">
        <nav className="flex items-center space-x-1 text-sm text-gray-500">
          {breadcrumbs.map((item, index) => (
            <div key={item.path} className="flex items-center">
              {index > 0 && <ChevronRight className="w-4 h-4 mx-1" />}
              {index === breadcrumbs.length - 1 ? (
                <span className="text-gray-900 font-medium flex items-center">
                  {index === 0 && <FolderIcon className="w-4 h-4 mr-1" />}
                  {item.name}
                </span>
              ) : (
                <Link
                  href={item.path === '' ? '/' : `/folder/${item.path}`}
                  className="text-gray-500 hover:text-gray-700 transition-colors flex items-center"
                  onClick={() => onBreadcrumbClick(item.path)}
                >
                  {index === 0 && <FolderIcon className="w-4 h-4 mr-1" />}
                  {item.name}
                </Link>
              )}
            </div>
          ))}
        </nav>
        
        {/* Share Button - only show if we're in a specific folder */}
        {breadcrumbs.length > 0 && getCurrentFolderPath() && (
          <button
            onClick={() => setShareDialogOpen(true)}
            className="flex items-center px-3 py-1.5 text-sm bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
            title="Share this folder"
          >
            <Share2 className="w-4 h-4 mr-1" />
            Share
          </button>
        )}
      </div>

      {folders.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {folders.map((folder) => (
            <FolderTooltip key={folder.id} folder={folder}>
              <button
                onClick={() => onFolderSelect(folder.path)}
                className="flex items-center p-3 border border-gray-200 rounded-lg hover:border-primary-300 hover:shadow-sm transition-colors w-full"
              >
                {/* Show different icon based on visit status */}
                {folder.last_visited ? (
                  <FolderCheck className="w-8 h-8 text-green-500 mr-3 flex-shrink-0" />
                ) : (
                  <FolderIcon className="w-8 h-8 text-gray-400 mr-3 flex-shrink-0" />
                )}
                <div className="text-left min-w-0 flex-1">
                  <div className="flex items-center">
                    <p className="font-medium text-gray-900 truncate">
                      {folder.name}
                    </p>
                  </div>
                  <p className="text-sm text-gray-500">
                    {folder.photo_count > 0 && `${folder.photo_count} photos`}
                    {folder.photo_count > 0 && folder.subfolder_count > 0 && ' • '}
                    {folder.subfolder_count > 0 && `${folder.subfolder_count} folders`}
                    {folder.photo_count === 0 && folder.subfolder_count === 0 && 'Empty folder'}
                  </p>
                </div>
              </button>
            </FolderTooltip>
          ))}
        </div>
      )}
      
      {/* Share Dialog */}
      <ShareDialog
        isOpen={shareDialogOpen}
        onClose={() => setShareDialogOpen(false)}
        folderPath={getCurrentFolderPath()}
        folderName={getCurrentFolderName()}
      />
    </div>
  );
}
