"use client";

import { Folder } from "@/types";
import { Folder as FolderIcon, FolderCheck, ChevronRight } from "lucide-react";
import FolderTooltip from "./FolderTooltip";

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
  return (
    <div className="bg-white rounded-lg shadow p-6">
      {/* Breadcrumb Navigation */}
      <div className="mb-4">
        <nav className="flex items-center space-x-1 text-sm text-gray-500">
          {breadcrumbs.map((item, index) => (
            <div key={item.path} className="flex items-center">
              {index > 0 && <ChevronRight className="w-4 h-4 mx-1" />}
              <button
                onClick={() => onBreadcrumbClick(item.path)}
                className={`hover:text-gray-700 transition-colors ${
                  index === breadcrumbs.length - 1
                    ? "text-gray-900 font-medium cursor-default"
                    : "text-gray-500 hover:text-gray-700"
                }`}
                disabled={index === breadcrumbs.length - 1}
              >
                <div className="flex items-center">
                  {index === 0 && <FolderIcon className="w-4 h-4 mr-1" />}
                  {item.name}
                </div>
              </button>
            </div>
          ))}
        </nav>
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
    </div>
  );
}
