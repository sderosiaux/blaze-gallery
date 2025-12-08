"use client";

import { Image, HardDrive, Folder, Eye, Database } from "lucide-react";
import { BasicStats } from "@/types/stats";
import { formatBytes } from "@/lib/format";

interface StatsOverviewProps {
  stats: BasicStats;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center">
        {icon}
        <div className="ml-4">
          <p className="text-sm font-medium text-gray-600">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

export default function StatsOverview({ stats }: StatsOverviewProps) {
  return (
    <section id="overview" className="space-y-4 scroll-mt-24">
      <h2 className="text-xl font-semibold text-gray-800 border-b-2 border-gray-200 pb-2">
        Gallery Overview
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <StatCard
          icon={<Image className="w-8 h-8 text-blue-600" />}
          label="Total Photos"
          value={stats.total_photos.toLocaleString()}
        />
        <StatCard
          icon={<HardDrive className="w-8 h-8 text-green-600" />}
          label="Total Storage"
          value={formatBytes(stats.total_storage_bytes)}
        />
        <StatCard
          icon={<Folder className="w-8 h-8 text-purple-600" />}
          label="Active Folders"
          value={stats.total_folders_with_photos.toLocaleString()}
        />
        <StatCard
          icon={<Eye className="w-8 h-8 text-red-600" />}
          label="Favorites"
          value={stats.total_favorites.toLocaleString()}
        />
        <StatCard
          icon={<Database className="w-8 h-8 text-orange-600" />}
          label="Avg Photo Size"
          value={formatBytes(stats.avg_photo_size_bytes)}
        />
      </div>
    </section>
  );
}
