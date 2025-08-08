import React from "react";

interface BlazeIconProps {
  size?: number | string;
  className?: string;
}

export default function BlazeIcon({
  size = 32,
  className = "",
}: BlazeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient
          id="lightningGradient"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
        >
          <stop offset="0%" style={{ stopColor: "#FBBF24", stopOpacity: 1 }} />
          <stop
            offset="100%"
            style={{ stopColor: "#F59E0B", stopOpacity: 1 }}
          />
        </linearGradient>
        <linearGradient id="photoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#3B82F6", stopOpacity: 1 }} />
          <stop
            offset="100%"
            style={{ stopColor: "#1E40AF", stopOpacity: 1 }}
          />
        </linearGradient>
      </defs>

      {/* Photo grid layout */}
      <g>
        {/* Photo frames */}
        <rect
          x="3"
          y="5"
          width="9"
          height="7"
          rx="1"
          fill="url(#photoGradient)"
          opacity="0.9"
        />
        <rect
          x="14"
          y="5"
          width="9"
          height="7"
          rx="1"
          fill="url(#photoGradient)"
          opacity="0.7"
        />
        <rect
          x="3"
          y="14"
          width="9"
          height="7"
          rx="1"
          fill="url(#photoGradient)"
          opacity="0.8"
        />
        <rect
          x="14"
          y="14"
          width="9"
          height="7"
          rx="1"
          fill="url(#photoGradient)"
          opacity="0.6"
        />

        {/* Photo content suggestions */}
        <rect
          x="4"
          y="6"
          width="7"
          height="5"
          rx="0.5"
          fill="white"
          opacity="0.2"
        />
        <rect
          x="15"
          y="6"
          width="7"
          height="5"
          rx="0.5"
          fill="white"
          opacity="0.2"
        />
        <rect
          x="4"
          y="15"
          width="7"
          height="5"
          rx="0.5"
          fill="white"
          opacity="0.2"
        />
        <rect
          x="15"
          y="15"
          width="7"
          height="5"
          rx="0.5"
          fill="white"
          opacity="0.2"
        />

        {/* Small image icons */}
        <circle cx="6" cy="8" r="1.5" fill="white" opacity="0.4" />
        <circle cx="17" cy="8" r="1.5" fill="white" opacity="0.3" />
        <circle cx="6" cy="17" r="1.5" fill="white" opacity="0.3" />
        <circle cx="17" cy="17" r="1.5" fill="white" opacity="0.2" />
      </g>

      {/* Lightning bolt for speed (Blaze) */}
      <g transform="translate(24, 2)">
        <path
          d="M2 0 L0 4 L2 4 L0 8 L4 4 L2 4 L4 0 Z"
          fill="url(#lightningGradient)"
        />
      </g>

      {/* Speed lines */}
      <g opacity="0.3">
        <line
          x1="26"
          y1="12"
          x2="28"
          y2="12"
          stroke="#FBBF24"
          strokeWidth="1"
        />
        <line
          x1="26"
          y1="16"
          x2="29"
          y2="16"
          stroke="#FBBF24"
          strokeWidth="1"
        />
        <line
          x1="25"
          y1="20"
          x2="28"
          y2="20"
          stroke="#FBBF24"
          strokeWidth="1"
        />
      </g>
    </svg>
  );
}
