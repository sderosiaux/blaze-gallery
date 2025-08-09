import { FolderStats } from '@/types/stats';
import { useState } from 'react';

interface FolderHeatmapProps {
  folders: FolderStats[];
  type: 'size' | 'count';
  maxItems?: number;
}

export default function FolderHeatmap({ folders, type, maxItems = 20 }: FolderHeatmapProps) {
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null);
  
  // Take only the top folders and calculate heat intensity
  const topFolders = folders.slice(0, maxItems);
  if (topFolders.length === 0) return null;

  const maxValue = Math.max(...topFolders.map(f => type === 'size' ? f.total_size : f.photo_count));
  const minValue = Math.min(...topFolders.map(f => type === 'size' ? f.total_size : f.photo_count));

  const getHeatIntensity = (value: number) => {
    if (maxValue === minValue) return 1;
    return (value - minValue) / (maxValue - minValue);
  };

  const getHeatColor = (intensity: number) => {
    // Use a gradient from cool blue to hot red
    const hue = Math.round((1 - intensity) * 240); // 240 = blue, 0 = red
    const saturation = Math.round(50 + intensity * 50); // 50% to 100%
    const lightness = Math.round(85 - intensity * 35); // 85% to 50%
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };

  const formatValue = (folder: FolderStats) => {
    if (type === 'size') {
      const bytes = folder.total_size;
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    } else {
      return `${folder.photo_count.toLocaleString()} photos`;
    }
  };

  const getFolderDisplayName = (folder: FolderStats) => {
    // Show just the folder name, not the full path
    return folder.name || folder.path.split('/').pop() || 'Root';
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center text-sm text-gray-600">
        <span>Folder {type === 'size' ? 'Storage' : 'Photo Count'} Heatmap</span>
        <div className="flex items-center space-x-2">
          <span className="text-xs">Less</span>
          <div className="flex">
            {Array.from({ length: 10 }, (_, i) => (
              <div
                key={i}
                className="w-3 h-3"
                style={{ backgroundColor: getHeatColor(i / 9) }}
              />
            ))}
          </div>
          <span className="text-xs">More</span>
        </div>
      </div>
      
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {topFolders.map((folder, index) => {
          const value = type === 'size' ? folder.total_size : folder.photo_count;
          const intensity = getHeatIntensity(value);
          const isHovered = hoveredFolder === folder.path;
          
          return (
            <div
              key={folder.path}
              className={`
                relative p-3 rounded-lg border-2 cursor-pointer transition-all duration-200
                ${isHovered ? 'border-gray-400 transform scale-105' : 'border-transparent hover:border-gray-300'}
              `}
              style={{ backgroundColor: getHeatColor(intensity) }}
              onMouseEnter={() => setHoveredFolder(folder.path)}
              onMouseLeave={() => setHoveredFolder(null)}
              title={`${folder.path}\n${formatValue(folder)}`}
            >
              <div className="text-center">
                <div className="text-sm font-medium text-gray-800 truncate mb-1">
                  {getFolderDisplayName(folder)}
                </div>
                <div className="text-xs text-gray-700">
                  {formatValue(folder)}
                </div>
              </div>
              
              {/* Hover overlay with full details */}
              {isHovered && (
                <div className="absolute z-10 bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg whitespace-nowrap">
                  <div className="font-medium">{getFolderDisplayName(folder)}</div>
                  <div className="text-gray-300">{folder.path}</div>
                  <div className="mt-1">
                    <div>{folder.photo_count.toLocaleString()} photos</div>
                    <div>{formatValue(folder)}</div>
                  </div>
                  {/* Arrow */}
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      <div className="text-xs text-gray-500 text-center">
        Showing top {topFolders.length} folders by {type === 'size' ? 'storage size' : 'photo count'}
      </div>
    </div>
  );
}