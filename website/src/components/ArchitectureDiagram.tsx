'use client'

import { useState, useEffect } from 'react'

export default function ArchitectureDiagram() {
  const [animationStep, setAnimationStep] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setAnimationStep(prev => (prev + 1) % 4)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  return (
    <section className="py-20 bg-white">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            Simple, Secure Architecture
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Blaze Gallery acts as a smart bridge between you and your Backblaze B2 storage, 
            providing fast access while keeping your photos safely in your own cloud.
          </p>
        </div>

        {/* Architecture Diagram */}
        <div className="max-w-6xl mx-auto mb-16">
          <div className="relative bg-gradient-to-br from-gray-50 to-blue-50 p-8 rounded-2xl">
            {/* User Device */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
              
              {/* Left: User Devices */}
              <div className="text-center">
                <div className="bg-white p-6 rounded-xl shadow-md mb-4">
                  <div className="text-4xl mb-2">📱💻</div>
                  <h3 className="font-bold text-gray-900 mb-2">Your Devices</h3>
                  <p className="text-sm text-gray-600">
                    Access from anywhere<br />
                    Mobile & Desktop
                  </p>
                </div>
                
                {/* Connection Animation */}
                <div className={`hidden md:block absolute top-1/2 left-1/3 w-16 h-0.5 bg-gradient-to-r from-blue-400 to-blaze-400 transition-all duration-500 ${
                  animationStep >= 1 ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
                }`}>
                  <div className="absolute -right-2 -top-2 w-4 h-4 bg-blaze-500 rounded-full animate-pulse" />
                </div>
              </div>

              {/* Center: Blaze Gallery */}
              <div className="text-center relative">
                <div className={`bg-gradient-to-br from-blaze-500 to-blaze-600 p-8 rounded-xl shadow-lg text-white transition-all duration-500 ${
                  animationStep >= 1 ? 'scale-105 shadow-2xl' : 'scale-100'
                }`}>
                  <div className="text-5xl mb-3">🔥</div>
                  <h3 className="font-bold text-xl mb-2">Blaze Gallery</h3>
                  <div className="text-sm opacity-90 space-y-1">
                    <div>• Smart Caching</div>
                    <div>• Fast Thumbnails</div>
                    <div>• Secure Sharing</div>
                    <div>• Photo Organization</div>
                  </div>
                </div>

                {/* Processing indicators */}
                <div className={`mt-4 flex justify-center space-x-2 transition-opacity duration-500 ${
                  animationStep >= 2 ? 'opacity-100' : 'opacity-0'
                }`}>
                  <div className="w-2 h-2 bg-blaze-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-blaze-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-blaze-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>

                {/* Connection to B2 Animation */}
                <div className={`hidden md:block absolute top-1/2 right-0 w-16 h-0.5 bg-gradient-to-r from-blaze-400 to-blue-500 transition-all duration-500 ${
                  animationStep >= 3 ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
                }`}>
                  <div className="absolute -right-2 -top-2 w-4 h-4 bg-blue-500 rounded-full animate-pulse" />
                </div>
              </div>

              {/* Right: Backblaze B2 */}
              <div className="text-center">
                <div className="bg-white p-6 rounded-xl shadow-md mb-4">
                  <div className="text-4xl mb-2">☁️</div>
                  <h3 className="font-bold text-gray-900 mb-2">Backblaze B2</h3>
                  <p className="text-sm text-gray-600">
                    Your photos stored safely<br />
                    Enterprise-grade cloud
                  </p>
                </div>

                {/* Data indicators */}
                <div className={`flex justify-center space-x-1 transition-opacity duration-500 ${
                  animationStep === 0 ? 'opacity-100' : 'opacity-50'
                }`}>
                  <div className="w-1 h-8 bg-blue-300 rounded-full" />
                  <div className="w-1 h-6 bg-blue-400 rounded-full" />
                  <div className="w-1 h-10 bg-blue-500 rounded-full" />
                  <div className="w-1 h-4 bg-blue-300 rounded-full" />
                  <div className="w-1 h-7 bg-blue-400 rounded-full" />
                </div>
              </div>
            </div>

            {/* Data Flow Labels */}
            <div className="hidden md:flex justify-between items-center mt-8 text-sm text-gray-600">
              <div className={`transition-opacity duration-500 ${animationStep >= 1 ? 'opacity-100' : 'opacity-50'}`}>
                📡 HTTPS Request
              </div>
              <div className={`transition-opacity duration-500 ${animationStep >= 2 ? 'opacity-100' : 'opacity-50'}`}>
                ⚡ Smart Processing
              </div>
              <div className={`transition-opacity duration-500 ${animationStep >= 3 ? 'opacity-100' : 'opacity-50'}`}>
                📤 B2 API Calls
              </div>
            </div>
          </div>
        </div>

        {/* Key Benefits */}
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🔒</span>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">Your Data, Your Control</h3>
            <p className="text-gray-600">
              Photos never leave your Backblaze B2 account. Blaze Gallery only reads your data, 
              never modifies or stores it elsewhere.
            </p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⚡</span>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">Lightning Fast Access</h3>
            <p className="text-gray-600">
              Smart caching and on-demand thumbnail generation means your photos load 
              instantly, even large RAW files.
            </p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 bg-blaze-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🛡️</span>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">Enterprise Security</h3>
            <p className="text-gray-600">
              Uses read-only API keys, secure session management, and follows security 
              best practices. No backdoors, no data mining.
            </p>
          </div>
        </div>

        {/* Technical Details */}
        <div className="mt-16 bg-gray-50 p-8 rounded-xl max-w-4xl mx-auto">
          <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">How It Works</h3>
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h4 className="font-semibold text-gray-900 mb-3">🔄 Sync Process</h4>
              <ul className="text-gray-600 space-y-2 text-sm">
                <li>• Scans your B2 bucket structure</li>
                <li>• Indexes photos and metadata</li>
                <li>• Generates thumbnails on-demand</li>
                <li>• Caches locally for fast access</li>
                <li>• Respects folder organization</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-3">🚀 Performance</h4>
              <ul className="text-gray-600 space-y-2 text-sm">
                <li>• Sub-second photo loading</li>
                <li>• Progressive image enhancement</li>
                <li>• Intelligent preloading</li>
                <li>• Minimal bandwidth usage</li>
                <li>• Responsive on mobile devices</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}