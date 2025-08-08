import { useState } from "react";
import { Photo } from "@/types";

interface PhotoTooltipProps {
  photo: Photo;
  children: React.ReactNode;
}

export default function PhotoTooltip({ photo, children }: PhotoTooltipProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const formatFileSize = (bytes: number) => {
    const sizes = ["Bytes", "KB", "MB", "GB"];
    if (bytes === 0) return "0 Bytes";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  };

  const getTooltipContent = () => {
    const parts = [];

    if (photo.size) {
      parts.push(formatFileSize(photo.size));
    }

    if (photo.metadata?.date_taken) {
      parts.push(new Date(photo.metadata.date_taken).toLocaleDateString());
    }

    if (photo.metadata?.dimensions) {
      parts.push(
        `${photo.metadata.dimensions.width}×${photo.metadata.dimensions.height}`,
      );
    }

    if (photo.metadata?.location) {
      parts.push("📍 GPS");
    }

    return parts.length > 0 ? parts.join(" • ") : null;
  };

  const tooltipContent = getTooltipContent();

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {children}

      {showTooltip && tooltipContent && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-50">
          <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap">
            <div className="font-medium mb-1 truncate max-w-xs">
              {photo.filename}
            </div>
            <div className="text-gray-300">{tooltipContent}</div>
            {/* Arrow */}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
          </div>
        </div>
      )}
    </div>
  );
}
