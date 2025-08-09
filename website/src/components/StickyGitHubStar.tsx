'use client'

import { useState, useEffect } from 'react'

export default function StickyGitHubStar() {
  const [isVisible, setIsVisible] = useState(false)
  const [stars, setStars] = useState(0)

  useEffect(() => {
    // Show button after user scrolls down a bit
    const handleScroll = () => {
      setIsVisible(window.scrollY > 100)
    }

    window.addEventListener('scroll', handleScroll)
    
    // Simulate GitHub stars (in real implementation, you'd fetch from GitHub API)
    setStars(Math.floor(Math.random() * 500) + 100)
    
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  if (!isVisible) return null

  return (
    <div className="fixed top-4 right-4 z-50 animate-fade-in-up">
      <a
        href="https://github.com/sderosiaux/blaze-gallery"
        target="_blank"
        rel="noopener noreferrer"
        className="bg-gray-900 hover:bg-black text-white px-4 py-3 rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 flex items-center space-x-3 group"
      >
        <div className="text-yellow-400 text-xl group-hover:scale-110 transition-transform">
          ⭐
        </div>
        <div>
          <div className="font-semibold text-sm">Star on GitHub</div>
          <div className="text-xs text-gray-300">{stars.toLocaleString()} stars</div>
        </div>
        <div className="text-gray-400 group-hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </div>
      </a>
      
      {/* Optional: Close button for mobile */}
      <button
        onClick={() => setIsVisible(false)}
        className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white w-6 h-6 rounded-full text-xs flex items-center justify-center transition-colors md:hidden"
        aria-label="Close"
      >
        ×
      </button>
    </div>
  )
}