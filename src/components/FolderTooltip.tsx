"use client";

import { useState } from "react";
import { Folder } from "@/types";
import { Calendar, Clock, HardDrive, Eye } from "lucide-react";

interface FolderTooltipProps {
  folder: Folder;
  children: React.ReactNode;
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(dateString: string | undefined): string {
  if (!dateString) return "Never";

  // Handle SQLite timestamp format - assume it's UTC if no timezone specified
  const date = dateString.includes('T') || dateString.includes('Z') 
    ? new Date(dateString) 
    : new Date(dateString + 'Z'); // Append 'Z' to treat as UTC
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;

  return date.toLocaleDateString();
}

export default function FolderTooltip({
  folder,
  children,
}: FolderTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}

      {isVisible && (
        <div className="absolute z-50 bottom-full mb-2 left-1/2 transform -translate-x-1/2">
          <div className="bg-gray-900 text-white text-sm rounded-lg px-4 py-3 shadow-lg max-w-sm min-w-64">
            <div className="font-medium text-white mb-2 truncate">
              {folder.name}
            </div>

            <div className="space-y-1 text-gray-300">
              <div className="flex items-center">
                <Eye className="w-3 h-3 mr-2 flex-shrink-0" />
                <span className="text-xs">
                  Visited: {formatDate(folder.last_visited)}
                </span>
              </div>

              <div className="flex items-center">
                <Clock className="w-3 h-3 mr-2 flex-shrink-0" />
                <span className="text-xs">
                  Synced: {formatDate(folder.last_synced)}
                </span>
              </div>

              <div className="flex items-center">
                <HardDrive className="w-3 h-3 mr-2 flex-shrink-0" />
                <span className="text-xs">
                  Size: {formatBytes(folder.total_size)}
                </span>
              </div>

              <div className="flex items-center">
                <Calendar className="w-3 h-3 mr-2 flex-shrink-0" />
                <span className="text-xs">
                  Created:{" "}
                  {formatDate(folder.folder_created_at || folder.created_at)}
                </span>
              </div>
            </div>

            {/* Tooltip arrow */}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2">
              <div className="border-4 border-transparent border-t-gray-900"></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
