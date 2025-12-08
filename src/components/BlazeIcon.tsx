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
          id="primaryGradient"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
        >
          <stop offset="0%" style={{ stopColor: "#3B82F6", stopOpacity: 1 }} />
          <stop
            offset="100%"
            style={{ stopColor: "#1D4ED8", stopOpacity: 1 }}
          />
        </linearGradient>
        <linearGradient id="accentGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#F59E0B", stopOpacity: 1 }} />
          <stop
            offset="100%"
            style={{ stopColor: "#D97706", stopOpacity: 1 }}
          />
        </linearGradient>
        <linearGradient id="photoContent1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#10B981", stopOpacity: 1 }} />
          <stop
            offset="100%"
            style={{ stopColor: "#059669", stopOpacity: 1 }}
          />
        </linearGradient>
        <linearGradient id="photoContent2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#F472B6", stopOpacity: 1 }} />
          <stop
            offset="100%"
            style={{ stopColor: "#EC4899", stopOpacity: 1 }}
          />
        </linearGradient>
      </defs>

      <g transform="translate(16, 16)">
        {/* Photo Gallery Grid - 3x3 layout */}

        {/* Top row */}
        <rect
          x="-12"
          y="-10"
          width="7"
          height="5"
          rx="1"
          fill="url(#primaryGradient)"
        />
        <rect
          x="-11"
          y="-9"
          width="5"
          height="3"
          rx="0.5"
          fill="white"
          opacity="0.9"
        />
        <rect
          x="-9.5"
          y="-8"
          width="2"
          height="1.5"
          rx="0.2"
          fill="url(#photoContent1)"
          opacity="0.7"
        />
        <circle cx="-9" cy="-7.5" r="0.3" fill="#FFF" opacity="0.8" />

        <rect
          x="-3"
          y="-10"
          width="7"
          height="5"
          rx="1"
          fill="url(#accentGradient)"
        />
        <rect
          x="-2"
          y="-9"
          width="5"
          height="3"
          rx="0.5"
          fill="white"
          opacity="0.9"
        />
        <rect
          x="-0.5"
          y="-8"
          width="2"
          height="1.5"
          rx="0.2"
          fill="url(#photoContent2)"
          opacity="0.7"
        />

        <rect
          x="6"
          y="-10"
          width="7"
          height="5"
          rx="1"
          fill="url(#primaryGradient)"
        />
        <rect
          x="7"
          y="-9"
          width="5"
          height="3"
          rx="0.5"
          fill="white"
          opacity="0.9"
        />
        <circle
          cx="9"
          cy="-7.5"
          r="0.4"
          fill="url(#accentGradient)"
          opacity="0.6"
        />

        {/* Middle row */}
        <rect
          x="-12"
          y="-3"
          width="7"
          height="5"
          rx="1"
          fill="url(#photoContent2)"
          opacity="0.8"
        />
        <rect
          x="-11"
          y="-2"
          width="5"
          height="3"
          rx="0.5"
          fill="white"
          opacity="0.9"
        />
        <rect
          x="-10"
          y="-1.5"
          width="3"
          height="2"
          rx="0.3"
          fill="#6B7280"
          opacity="0.5"
        />

        <rect
          x="-3"
          y="-3"
          width="7"
          height="5"
          rx="1"
          fill="url(#primaryGradient)"
          opacity="0.9"
        />
        <rect
          x="-2"
          y="-2"
          width="5"
          height="3"
          rx="0.5"
          fill="white"
          opacity="0.9"
        />
        <path
          d="M-2 0 Q-1 -1.5 0 -1 Q1 -0.5 2 -1.5 Q3 -2.5 3 -1 V1 H-2 Z"
          fill="#94A3B8"
          opacity="0.6"
        />
        <circle cx="1.5" cy="-1.8" r="0.3" fill="#FCD34D" />

        <rect
          x="6"
          y="-3"
          width="7"
          height="5"
          rx="1"
          fill="url(#photoContent1)"
          opacity="0.8"
        />
        <rect
          x="7"
          y="-2"
          width="5"
          height="3"
          rx="0.5"
          fill="white"
          opacity="0.9"
        />
        <rect
          x="8"
          y="-1"
          width="3"
          height="1"
          rx="0.2"
          fill="url(#accentGradient)"
          opacity="0.4"
        />

        {/* Bottom row */}
        <rect
          x="-12"
          y="4"
          width="7"
          height="5"
          rx="1"
          fill="url(#accentGradient)"
          opacity="0.7"
        />
        <rect
          x="-11"
          y="5"
          width="5"
          height="3"
          rx="0.5"
          fill="white"
          opacity="0.9"
        />
        <circle
          cx="-8.5"
          cy="6.5"
          r="0.5"
          fill="url(#primaryGradient)"
          opacity="0.6"
        />
        <circle
          cx="-7.5"
          cy="7"
          r="0.3"
          fill="url(#photoContent2)"
          opacity="0.5"
        />

        <rect
          x="-3"
          y="4"
          width="7"
          height="5"
          rx="1"
          fill="url(#primaryGradient)"
          opacity="0.8"
        />
        <rect
          x="-2"
          y="5"
          width="5"
          height="3"
          rx="0.5"
          fill="white"
          opacity="0.9"
        />
        <rect
          x="-1"
          y="6"
          width="3"
          height="1.5"
          rx="0.2"
          fill="url(#photoContent1)"
          opacity="0.5"
        />

        <rect
          x="6"
          y="4"
          width="7"
          height="5"
          rx="1"
          fill="url(#photoContent2)"
          opacity="0.9"
        />
        <rect
          x="7"
          y="5"
          width="5"
          height="3"
          rx="0.5"
          fill="white"
          opacity="0.9"
        />
        <path
          d="M7 8 Q8.5 6.5 10 7 Q11.5 7.5 12 7 V8 H7 Z"
          fill="#9CA3AF"
          opacity="0.4"
        />
      </g>
    </svg>
  );
}
