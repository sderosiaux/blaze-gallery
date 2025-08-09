'use client'

import { useState } from 'react'

type DemoType = 'folder' | 'audit' | 'share' | 'random'

interface DemoOption {
  id: DemoType
  title: string
  description: string
  icon: string
  color: string
}

const demoOptions: DemoOption[] = [
  {
    id: 'folder',
    title: 'Smart Folder Browser',
    description: 'Navigate thousands of photos organized by folder structure',
    icon: '📁',
    color: 'blue'
  },
  {
    id: 'audit',
    title: 'B2 Performance Audit',
    description: 'Real-time metrics showing cost savings and performance',
    icon: '📊',
    color: 'green'
  },
  {
    id: 'share',
    title: 'Secure Sharing Dialog',
    description: 'Generate password-protected links for any folder or photo',
    icon: '🔗',
    color: 'purple'
  },
  {
    id: 'random',
    title: 'Rediscover Your Photos',
    description: 'AI-powered random photo discovery based on date ranges',
    icon: '🎲',
    color: 'blaze'
  }
]

// Mock data for demos
const mockFolders = [
  { name: '2024-vacation-greece', photos: 847, size: '12.4 GB', lastModified: '2 days ago' },
  { name: '2024-family-reunion', photos: 234, size: '3.8 GB', lastModified: '1 week ago' },
  { name: '2023-wedding-photos', photos: 1203, size: '18.7 GB', lastModified: '3 months ago' },
  { name: '2023-nature-photography', photos: 456, size: '8.2 GB', lastModified: '5 months ago' },
  { name: '2022-baby-first-year', photos: 892, size: '15.6 GB', lastModified: '1 year ago' }
]

const mockAuditData = {
  currentMonthCost: 4.32,
  googlePhotosCost: 120,
  icloudCost: 120,
  totalPhotos: 12847,
  totalStorage: '187.6 GB',
  bandwidthUsed: '12.4 GB',
  apiCalls: 2847,
  avgLoadTime: '0.8s'
}

const mockRandomPhotos = [
  { date: 'Aug 2023', location: 'Santorini, Greece', mood: '🌅 Golden Hour' },
  { date: 'Dec 2022', location: 'Home', mood: '🎄 Holiday Magic' },
  { date: 'Jun 2021', location: 'Mountain Trail', mood: '🥾 Adventure' },
  { date: 'Mar 2020', location: 'Garden', mood: '🌸 Spring Blooms' }
]

export default function InteractiveDemo() {
  const [activeDemo, setActiveDemo] = useState<DemoType>('folder')
  
  const getColorClasses = (color: string, isActive = false) => {
    const colors = {
      blue: isActive ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-700 hover:bg-blue-200',
      green: isActive ? 'bg-green-500 text-white' : 'bg-green-100 text-green-700 hover:bg-green-200',
      purple: isActive ? 'bg-purple-500 text-white' : 'bg-purple-100 text-purple-700 hover:bg-purple-200',
      blaze: isActive ? 'bg-blaze-500 text-white' : 'bg-blaze-100 text-blaze-700 hover:bg-blaze-200'
    }
    return colors[color as keyof typeof colors] || colors.blue
  }

  const renderDemo = () => {
    switch (activeDemo) {
      case 'folder':
        return (
          <div className="bg-white rounded-lg p-6 shadow-inner">
            <div className="flex items-center justify-between mb-6">
              <h4 className="text-lg font-semibold text-gray-900">My Photo Collection</h4>
              <div className="text-sm text-gray-500">5 folders • 3,632 photos • 58.7 GB</div>
            </div>
            <div className="space-y-3">
              {mockFolders.map((folder, idx) => (
                <div 
                  key={folder.name}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  <div className="flex items-center space-x-4">
                    <div className="text-2xl">📁</div>
                    <div>
                      <div className="font-medium text-gray-900">{folder.name}</div>
                      <div className="text-sm text-gray-500">{folder.photos} photos • {folder.size}</div>
                    </div>
                  </div>
                  <div className="text-sm text-gray-400">{folder.lastModified}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <div className="text-sm text-blue-700">
                💡 <strong>Pro tip:</strong> Click any folder to view photos with lightning-fast thumbnails generated on-demand.
              </div>
            </div>
          </div>
        )

      case 'audit':
        return (
          <div className="bg-white rounded-lg p-6 shadow-inner">
            <h4 className="text-lg font-semibold text-gray-900 mb-6">Performance & Cost Analysis</h4>
            
            {/* Cost Comparison */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">${mockAuditData.currentMonthCost}</div>
                <div className="text-sm text-green-700">Backblaze B2</div>
                <div className="text-xs text-green-600">This Month</div>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">${mockAuditData.googlePhotosCost}</div>
                <div className="text-sm text-red-700">Google Photos</div>
                <div className="text-xs text-red-600">Would Cost</div>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">${mockAuditData.icloudCost}</div>
                <div className="text-sm text-red-700">iCloud Photos</div>
                <div className="text-xs text-red-600">Would Cost</div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-lg font-semibold">{mockAuditData.totalPhotos.toLocaleString()}</div>
                <div className="text-sm text-gray-600">Total Photos</div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-lg font-semibold">{mockAuditData.totalStorage}</div>
                <div className="text-sm text-gray-600">Storage Used</div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-lg font-semibold">{mockAuditData.avgLoadTime}</div>
                <div className="text-sm text-gray-600">Avg Load Time</div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-lg font-semibold">{mockAuditData.bandwidthUsed}</div>
                <div className="text-sm text-gray-600">Bandwidth Used</div>
              </div>
            </div>

            <div className="mt-4 p-4 bg-green-50 rounded-lg">
              <div className="text-sm text-green-700">
                🎉 <strong>Monthly Savings:</strong> ${mockAuditData.googlePhotosCost - mockAuditData.currentMonthCost} compared to Google Photos!
              </div>
            </div>
          </div>
        )

      case 'share':
        return (
          <div className="bg-white rounded-lg p-6 shadow-inner">
            <h4 className="text-lg font-semibold text-gray-900 mb-6">Share Folder: "2024-vacation-greece"</h4>
            
            <div className="space-y-6">
              {/* Share Options */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Share Type</label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 border-2 border-blue-200 bg-blue-50 rounded-lg cursor-pointer">
                    <div className="font-medium text-blue-900">🔒 Password Protected</div>
                    <div className="text-sm text-blue-700">Secure access with password</div>
                  </div>
                  <div className="p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                    <div className="font-medium text-gray-900">🔗 Public Link</div>
                    <div className="text-sm text-gray-600">Anyone with link can view</div>
                  </div>
                </div>
              </div>

              {/* Settings */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input 
                    type="text" 
                    value="sunset2024!" 
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50"
                    readOnly
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expires</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50">
                    <option>7 days</option>
                    <option>30 days</option>
                    <option>Never</option>
                  </select>
                </div>
              </div>

              {/* Generated Link */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Generated Share Link</label>
                <div className="flex">
                  <input 
                    type="text" 
                    value="https://gallery.yourdomain.com/share/abc123def456" 
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md bg-gray-50 text-sm"
                    readOnly
                  />
                  <button className="px-4 py-2 bg-blaze-600 text-white rounded-r-md hover:bg-blaze-700 transition-colors">
                    Copy
                  </button>
                </div>
              </div>

              {/* Permissions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Permissions</label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input type="checkbox" checked className="mr-2" readOnly />
                    <span className="text-sm">Allow viewing photos</span>
                  </label>
                  <label className="flex items-center">
                    <input type="checkbox" checked className="mr-2" readOnly />
                    <span className="text-sm">Allow downloading photos</span>
                  </label>
                  <label className="flex items-center">
                    <input type="checkbox" className="mr-2" readOnly />
                    <span className="text-sm">Allow commenting</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )

      case 'random':
        return (
          <div className="bg-white rounded-lg p-6 shadow-inner">
            <div className="flex items-center justify-between mb-6">
              <h4 className="text-lg font-semibold text-gray-900">Rediscover Your Memories</h4>
              <button className="px-4 py-2 bg-blaze-600 text-white rounded-md hover:bg-blaze-700 transition-colors">
                🎲 Surprise Me
              </button>
            </div>
            
            <div className="space-y-4 mb-6">
              {mockRandomPhotos.map((photo, idx) => (
                <div 
                  key={idx}
                  className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                  style={{ animationDelay: `${idx * 150}ms` }}
                >
                  <div className="w-16 h-16 bg-gradient-to-br from-blaze-200 to-blaze-300 rounded-lg flex items-center justify-center">
                    <span className="text-2xl">📸</span>
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{photo.date} • {photo.location}</div>
                    <div className="text-sm text-gray-500">{photo.mood}</div>
                  </div>
                  <div className="text-blaze-600 hover:text-blaze-700">
                    <span className="text-sm font-medium">View →</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-blaze-50 p-4 rounded-lg">
              <div className="text-sm text-blaze-700">
                🧠 <strong>Smart Discovery:</strong> Based on your viewing patterns, photo dates, and folder organization to surface forgotten gems.
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <section id="demo" className="py-20 bg-gray-50">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            See Blaze Gallery in Action
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Explore the powerful features that make Blaze Gallery the perfect solution 
            for managing your photo collection.
          </p>
        </div>

        {/* Demo Selection */}
        <div className="flex flex-wrap justify-center gap-4 mb-12">
          {demoOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => setActiveDemo(option.id)}
              className={`px-6 py-4 rounded-xl transition-all duration-200 ${getColorClasses(option.color, activeDemo === option.id)}`}
            >
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{option.icon}</span>
                <div className="text-left">
                  <div className="font-semibold">{option.title}</div>
                  <div className="text-sm opacity-90">{option.description}</div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Demo Display */}
        <div className="max-w-4xl mx-auto">
          <div className="bg-gray-100 p-8 rounded-xl">
            {renderDemo()}
          </div>
        </div>

        {/* Call to Action */}
        <div className="text-center mt-12">
          <p className="text-gray-600 mb-6">
            Ready to experience these features with your own photos?
          </p>
          <a
            href="#quick-start"
            className="bg-blaze-600 hover:bg-blaze-700 text-white px-8 py-3 rounded-lg font-semibold inline-block transition-colors"
          >
            Start Your Setup Now →
          </a>
        </div>
      </div>
    </section>
  )
}