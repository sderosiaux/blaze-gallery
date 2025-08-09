'use client'

import { motion } from 'framer-motion'

export default function HeroSection() {
  return (
    <section className="min-h-screen bg-white flex items-center justify-center relative overflow-hidden">
      {/* Massive Typography - Apple Style */}
      <div className="text-center px-6 max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 1, y: 0 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {/* Apple-style massive headline */}
          <h1 className="text-6xl md:text-8xl lg:text-9xl font-semibold text-black mb-8 leading-none tracking-tight">
            Your photos.
            <br />
            <span className="text-gray-400">Your rules.</span>
          </h1>
          
          {/* Minimal subtext */}
          <p className="text-2xl md:text-3xl text-gray-600 font-light mb-12 max-w-4xl mx-auto leading-relaxed">
            The self-hosted photo gallery that puts you in control.
          </p>
          
          {/* Simple, clean terminal */}
          <motion.div 
            className="bg-black rounded-2xl p-8 max-w-4xl mx-auto mb-16 text-left"
            initial={{ opacity: 1, scale: 1 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5, duration: 0.8 }}
          >
            <div className="font-mono text-green-400 text-lg space-y-2">
              <div>git clone https://github.com/sderosiaux/blaze-gallery.git</div>
              <div>cd blaze-gallery</div>
              <div className="text-gray-500"># Edit .env to setup your B2 bucket</div>
              <div>npm run dev</div>
              <div className="text-gray-500"># Done!</div>
            </div>
          </motion.div>

          {/* Minimal CTA */}
          <motion.a
            href="https://github.com/sderosiaux/blaze-gallery"
            className="inline-block bg-black text-white px-10 py-4 rounded-full text-xl font-medium hover:bg-gray-800 transition-colors"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
          >
            View on GitHub
          </motion.a>
        </motion.div>
      </div>
    </section>
  )
}