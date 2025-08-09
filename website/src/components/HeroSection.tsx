'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

export default function HeroSection() {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    setIsVisible(true)
  }, [])

  const fadeInUp = {
    initial: { opacity: 0, y: 60 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }
  }

  const staggerChildren = {
    animate: {
      transition: {
        staggerChildren: 0.2
      }
    }
  }

  return (
    <section className="relative min-h-screen flex items-center justify-center bg-white overflow-hidden">
      {/* Subtle gradient background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-50 via-white to-blue-50/30" />
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 25% 25%, rgba(99, 102, 241, 0.03) 0%, transparent 50%),
                           radial-gradient(circle at 75% 75%, rgba(139, 69, 19, 0.02) 0%, transparent 50%)`,
        }} />
      </div>
      
      {/* Main Content */}
      <motion.div 
        className="relative z-10 container mx-auto px-6 text-center max-w-5xl"
        variants={staggerChildren}
        initial="initial"
        animate="animate"
      >
        {/* Logo */}
        <motion.div 
          className="flex items-center justify-center space-x-4 mb-12"
          variants={fadeInUp}
        >
          <div className="relative">
            <div className="w-20 h-20 bg-gradient-to-br from-orange-500 to-red-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-orange-500/25">
              <span className="text-white text-4xl">🔥</span>
            </div>
            <div className="absolute -inset-1 bg-gradient-to-br from-orange-400 to-red-500 rounded-3xl opacity-20 blur-lg"></div>
          </div>
          <h1 className="text-6xl md:text-7xl font-light text-gray-900 tracking-tight">
            Blaze Gallery
          </h1>
        </motion.div>
        
        {/* Main Headline */}
        <motion.h2 
          className="text-5xl md:text-6xl lg:text-7xl font-light text-gray-900 mb-8 leading-tight text-balance max-w-4xl mx-auto"
          variants={fadeInUp}
        >
          Your Photos, <span className="bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent font-normal">Your Cloud</span>, <br className="hidden sm:block" />
          Your Control
        </motion.h2>
        
        {/* Subheadline */}
        <motion.p 
          className="text-xl md:text-2xl text-gray-600 mb-12 max-w-3xl mx-auto leading-relaxed font-light"
          variants={fadeInUp}
        >
          <span className="text-gray-900 font-medium">Free & open source</span> self-hosted photo gallery that connects directly to your{' '}
          <span className="text-gray-900 font-medium">Backblaze B2</span> storage. 
          View, organize, and share thousands of photos while maintaining complete control over your data.
        </motion.p>
        
        {/* Key Benefits */}
        <motion.div 
          className="flex flex-wrap justify-center gap-3 mb-12 text-sm"
          variants={fadeInUp}
        >
          <span className="bg-gray-100 text-gray-700 px-4 py-2 rounded-full font-medium hover:bg-gray-200 transition-colors">
            💚 100% Free Software
          </span>
          <span className="bg-gray-100 text-gray-700 px-4 py-2 rounded-full font-medium hover:bg-gray-200 transition-colors">
            🔒 Privacy First
          </span>
          <span className="bg-gray-100 text-gray-700 px-4 py-2 rounded-full font-medium hover:bg-gray-200 transition-colors">
            🚀 Docker Deploy
          </span>
          <span className="bg-gray-100 text-gray-700 px-4 py-2 rounded-full font-medium hover:bg-gray-200 transition-colors">
            📱 Mobile Ready
          </span>
        </motion.div>
        
        {/* Quick Start Commands */}
        <motion.div 
          className="bg-gray-950 text-white p-8 rounded-2xl max-w-4xl mx-auto mb-12 shadow-2xl border border-gray-800"
          variants={fadeInUp}
        >
          <div className="text-center mb-6">
            <span className="text-emerald-400 font-medium text-lg">Copy, paste, done:</span>
          </div>
          <div className="bg-black/40 p-6 rounded-xl font-mono text-left overflow-x-auto border border-gray-800">
            <motion.div 
              className="space-y-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, staggerChildren: 0.1 }}
            >
              <motion.code className="text-emerald-400 text-sm block" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}>git clone https://github.com/sderosiaux/blaze-gallery.git</motion.code>
              <motion.code className="text-emerald-400 text-sm block" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7 }}>cd blaze-gallery</motion.code>
              <motion.code className="text-emerald-400 text-sm block" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8 }}>cp .env.template .env</motion.code>
              <motion.code className="text-gray-500 text-sm block" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.9 }}># Edit .env with your B2 credentials</motion.code>
              <motion.code className="text-emerald-400 text-sm block" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.0 }}>docker-compose up -d</motion.code>
            </motion.div>
          </div>
        </motion.div>

        {/* CTA Buttons */}
        <motion.div 
          className="flex flex-col sm:flex-row gap-6 justify-center items-center"
          variants={fadeInUp}
        >
          <motion.a 
            href="https://github.com/sderosiaux/blaze-gallery" 
            className="group bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white px-8 py-4 rounded-2xl font-medium text-lg transition-all duration-300 shadow-xl hover:shadow-2xl hover:shadow-orange-500/25 flex items-center space-x-3 transform hover:scale-105"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <span className="text-xl group-hover:animate-pulse">⭐</span>
            <span>Star on GitHub</span>
          </motion.a>
        </motion.div>
        
        {/* Hero Image Mockup */}
        <motion.div 
          className="mt-20 max-w-6xl mx-auto"
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 1, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {/* Floating Browser Window */}
          <div className="relative">
            <div className="bg-white rounded-2xl shadow-2xl shadow-gray-900/10 border border-gray-200/50 overflow-hidden backdrop-blur-sm">
              {/* Browser Header */}
              <div className="bg-gray-50/80 backdrop-blur-sm border-b border-gray-200/50 px-6 py-4 flex items-center space-x-4">
                <div className="flex space-x-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full shadow-sm"></div>
                  <div className="w-3 h-3 bg-yellow-500 rounded-full shadow-sm"></div>
                  <div className="w-3 h-3 bg-green-500 rounded-full shadow-sm"></div>
                </div>
                <div className="flex-1 bg-white/80 backdrop-blur-sm rounded-lg px-4 py-2 text-sm text-gray-600 ml-4 border border-gray-200/50">
                  localhost:3000 • Blaze Gallery
                </div>
              </div>
              
              {/* Gallery Preview */}
              <div className="p-8 bg-gradient-to-br from-gray-50/50 to-white">
                <motion.div 
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"
                  variants={staggerChildren}
                  initial="initial"
                  animate="animate"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <motion.div 
                      key={i}
                      className="aspect-square bg-gradient-to-br from-gray-200 to-gray-300 rounded-xl shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer overflow-hidden group"
                      initial={{ opacity: 0, scale: 0.8, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ delay: i * 0.1, duration: 0.5 }}
                      whileHover={{ scale: 1.05, y: -5 }}
                    >
                      <div className="w-full h-full bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl flex items-center justify-center group-hover:from-orange-100 group-hover:to-red-100 transition-all duration-300">
                        <span className="text-3xl opacity-60 group-hover:opacity-80 transition-opacity">📸</span>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              </div>
            </div>
            
            {/* Floating Elements */}
            <motion.div 
              className="absolute -top-4 -right-4 w-8 h-8 bg-gradient-to-br from-orange-400 to-red-500 rounded-full shadow-lg"
              animate={{ 
                y: [0, -10, 0],
                rotate: [0, 180, 360]
              }}
              transition={{ 
                duration: 6,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            />
            <motion.div 
              className="absolute -bottom-6 -left-6 w-6 h-6 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full shadow-lg"
              animate={{ 
                y: [0, 10, 0],
                x: [0, 5, 0]
              }}
              transition={{ 
                duration: 4,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 1
              }}
            />
          </div>
        </motion.div>
      </motion.div>
      
      {/* Scroll Indicator */}
      <motion.div 
        className="absolute bottom-8 left-1/2 transform -translate-x-1/2"
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <div className="w-6 h-10 border-2 border-gray-400 rounded-full flex justify-center">
          <motion.div 
            className="w-1 h-3 bg-gray-600 rounded-full mt-2"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </motion.div>
    </section>
  )
}