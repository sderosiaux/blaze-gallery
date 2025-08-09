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
    // Smooth gradient from cool blue-green to warm red-orange
    // Clamp intensity between 0 and 1
    const clampedIntensity = Math.max(0, Math.min(1, intensity));
    
    // Smooth hue transition: 200° (cyan-blue) to 0° (red)
    const hue = 200 - (clampedIntensity * 200);
    
    // Smooth saturation transition: starts moderate, peaks in middle, stays high at end
    const saturation = 50 + (clampedIntensity * 45); // 50% to 95%
    
    // Smooth lightness transition: starts light, gets darker towards red
    const lightness = 88 - (clampedIntensity * 28); // 88% to 60%
    
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
        <span>{type === 'size' ? 'Storage Usage' : 'Photo Distribution'} by Folder</span>
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
      
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {topFolders.map((folder, index) => {
          const value = type === 'size' ? folder.total_size : folder.photo_count;
          const intensity = getHeatIntensity(value);
          const isHovered = hoveredFolder === folder.path;
          const baseColor = getHeatColor(intensity);
          
          return (
            <a
              key={folder.path}
              href={folder.path === '' ? '/' : `/folder/${folder.path}`}
              className={`
                block relative p-4 rounded-xl cursor-pointer transition-all duration-300 group
                ${isHovered 
                  ? 'transform scale-110 shadow-2xl z-10 ring-2 ring-white ring-opacity-60' 
                  : 'hover:scale-105 hover:shadow-lg shadow-md'
                }
              `}
              style={{ 
                background: `linear-gradient(135deg, ${baseColor}, ${getHeatColor(Math.min(intensity + 0.1, 1))})`,
                boxShadow: isHovered 
                  ? `0 20px 40px rgba(0,0,0,0.15), 0 0 20px ${baseColor}40`
                  : '0 4px 12px rgba(0,0,0,0.08)'
              }}
              onMouseEnter={() => setHoveredFolder(folder.path)}
              onMouseLeave={() => setHoveredFolder(null)}
              title={`${folder.path}\n${formatValue(folder)}\nClick to browse this folder`}
            >
              <div className="text-center relative z-10">
                <div className="text-sm font-semibold text-gray-900 truncate mb-1 drop-shadow-sm">
                  {getFolderDisplayName(folder)}
                </div>
                <div className="text-xs font-medium text-gray-800 drop-shadow-sm">
                  {type === 'size' ? formatValue(folder) : `${folder.photo_count.toLocaleString()}`}
                  {type === 'count' && <span className="text-gray-700 ml-1">photos</span>}
                </div>
              </div>
              
              {/* Hover overlay with full details */}
              {isHovered && (
                <div className="absolute z-20 bottom-full left-1/2 transform -translate-x-1/2 mb-3 px-4 py-3 bg-gray-900 bg-opacity-95 backdrop-blur-sm text-white text-sm rounded-xl shadow-2xl whitespace-nowrap border border-gray-700">
                  <div className="font-semibold text-white">{getFolderDisplayName(folder)}</div>
                  <div className="text-gray-300 text-xs mt-1 max-w-xs truncate">{folder.path}</div>
                  <div className="mt-2 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Photos:</span>
                      <span className="font-medium">{folder.photo_count.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Size:</span>
                      <span className="font-medium">
                        {type === 'size' ? formatValue(folder) : 
                         (() => {
                           const bytes = folder.total_size;
                           if (bytes === 0) return '0 B';
                           const k = 1024;
                           const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
                           const i = Math.floor(Math.log(bytes) / Math.log(k));
                           return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
                         })()
                        }
                      </span>
                    </div>
                  </div>
                  {/* Arrow */}
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-gray-900"></div>
                </div>
              )}
            </a>
          );
        })}
      </div>
      
      <div className="text-xs text-gray-500 text-center">
        Showing top {topFolders.length} folders by {type === 'size' ? 'storage size' : 'photo count'}
      </div>
    </div>
  );
}