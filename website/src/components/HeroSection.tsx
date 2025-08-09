'use client'

import { useState, useEffect } from 'react'

export default function HeroSection() {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    setIsVisible(true)
  }, [])

  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-blaze-50 to-orange-100 overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 25% 25%, rgba(249, 115, 22, 0.3) 0%, transparent 50%),
                           radial-gradient(circle at 75% 75%, rgba(234, 88, 12, 0.2) 0%, transparent 50%)`,
        }} />
      </div>
      
      {/* Main Content */}
      <div className="relative z-10 container mx-auto px-6 text-center">
        <div className={`transition-all duration-1000 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          {/* Logo */}
          <div className="flex items-center justify-center space-x-3 mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-blaze-400 to-blaze-600 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white text-3xl">🔥</span>
            </div>
            <h1 className="text-5xl md:text-6xl font-bold text-gray-900 tracking-tight">
              Blaze Gallery
            </h1>
          </div>
          
          {/* Main Headline */}
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight text-balance">
            Your Photos, <span className="text-blaze-600">Your Cloud</span>, <br className="hidden sm:block" />
            Your Control
          </h2>
          
          {/* Subheadline */}
          <p className="text-xl md:text-2xl text-gray-700 mb-8 max-w-3xl mx-auto leading-relaxed text-balance">
            Self-hosted photo gallery that connects directly to your{' '}
            <span className="font-semibold text-blaze-700">Backblaze B2</span> storage. 
            View, organize, and share thousands of photos while maintaining complete control over your data.
          </p>
          
          {/* Key Benefits */}
          <div className="flex flex-wrap justify-center gap-4 mb-10 text-sm font-medium">
            <span className="bg-white/80 text-blaze-700 px-4 py-2 rounded-full shadow-sm">
              🔒 Fully Self-Hosted
            </span>
            <span className="bg-white/80 text-blaze-700 px-4 py-2 rounded-full shadow-sm">
              💰 $6/TB vs $120/TB
            </span>
            <span className="bg-white/80 text-blaze-700 px-4 py-2 rounded-full shadow-sm">
              🚀 Docker Deploy
            </span>
            <span className="bg-white/80 text-blaze-700 px-4 py-2 rounded-full shadow-sm">
              📱 Mobile Friendly
            </span>
          </div>
          
          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a 
              href="#quick-start" 
              className="bg-blaze-600 hover:bg-blaze-700 text-white px-8 py-4 rounded-lg font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              Get Started Now
            </a>
            <a 
              href="#demo" 
              className="bg-white hover:bg-gray-50 text-blaze-600 border-2 border-blaze-600 px-8 py-4 rounded-lg font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              View Live Demo
            </a>
            <a 
              href="https://github.com/your-username/blaze-gallery" 
              className="text-gray-600 hover:text-gray-800 flex items-center space-x-2 px-4 py-2 transition-colors"
            >
              <span>⭐</span>
              <span>Star on GitHub</span>
            </a>
          </div>
        </div>
        
        {/* Hero Image Mockup */}
        <div className={`mt-16 transition-all duration-1000 delay-500 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <div className="relative max-w-5xl mx-auto">
            {/* Browser Frame */}
            <div className="bg-white rounded-t-lg shadow-2xl">
              {/* Browser Header */}
              <div className="bg-gray-100 rounded-t-lg px-4 py-3 flex items-center space-x-2">
                <div className="flex space-x-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                </div>
                <div className="flex-1 bg-white rounded-md px-3 py-1 text-sm text-gray-500 ml-4">
                  localhost:3000
                </div>
              </div>
              
              {/* Gallery Preview */}
              <div className="p-6 bg-gray-50">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <div 
                      key={i}
                      className="aspect-square bg-gradient-to-br from-blaze-200 to-blaze-300 rounded-lg shadow-sm animate-pulse-soft"
                      style={{ animationDelay: `${i * 0.2}s` }}
                    >
                      <div className="w-full h-full bg-gradient-to-br from-gray-300 to-gray-400 rounded-lg flex items-center justify-center">
                        <span className="text-2xl opacity-50">📸</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Scroll Indicator */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce-subtle">
        <div className="w-6 h-10 border-2 border-blaze-600 rounded-full flex justify-center">
          <div className="w-1 h-3 bg-blaze-600 rounded-full mt-2 animate-pulse"></div>
        </div>
      </div>
    </section>
  )
}