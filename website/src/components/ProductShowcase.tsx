'use client'

import { motion } from 'framer-motion'

export default function ProductShowcase() {
  return (
    <section className="bg-white py-32 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6">
        {/* Apple-style product showcase */}
        <motion.div
          className="text-center mb-24"
          initial={{ opacity: 1, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
        >
          <h2 className="text-5xl md:text-7xl font-semibold text-black mb-6 leading-none">
            Beautiful.
            <br />
            <span className="text-gray-400">Private.</span>
            <br />
            Yours.
          </h2>
        </motion.div>

        {/* Large product mockup - Apple style */}
        <motion.div
          className="relative mx-auto max-w-6xl mb-32"
          initial={{ opacity: 1, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease: [0.25, 0.1, 0.25, 1] }}
          viewport={{ once: true }}
        >
          {/* Main browser window */}
          <div className="bg-white rounded-3xl shadow-2xl shadow-black/20 border border-gray-200">
            {/* Browser chrome */}
            <div className="bg-gray-50 rounded-t-3xl px-8 py-6 border-b border-gray-200">
              <div className="flex items-center space-x-3">
                <div className="flex space-x-2">
                  <div className="w-4 h-4 bg-red-500 rounded-full"></div>
                  <div className="w-4 h-4 bg-yellow-500 rounded-full"></div>
                  <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                </div>
                <div className="flex-1 bg-white rounded-lg px-4 py-2 text-gray-500 font-mono text-sm">
                  localhost:3000
                </div>
              </div>
            </div>
            
            {/* Gallery content */}
            <div className="p-12">
              {/* Photo grid - Apple mosaic style */}
              <div className="grid grid-cols-4 gap-4 h-96">
                {/* Large feature photo */}
                <motion.div 
                  className="col-span-2 row-span-2 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl relative overflow-hidden group cursor-pointer"
                  whileHover={{ scale: 1.02 }}
                  transition={{ type: "spring", damping: 20 }}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-4xl opacity-40">🏔️</span>
                  </div>
                </motion.div>
                
                {/* Smaller photos */}
                <motion.div 
                  className="bg-gradient-to-br from-purple-100 to-purple-200 rounded-2xl relative overflow-hidden group cursor-pointer"
                  whileHover={{ scale: 1.05 }}
                  transition={{ type: "spring", damping: 20 }}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl opacity-40">🌅</span>
                  </div>
                </motion.div>
                
                <motion.div 
                  className="bg-gradient-to-br from-green-100 to-green-200 rounded-2xl relative overflow-hidden group cursor-pointer"
                  whileHover={{ scale: 1.05 }}
                  transition={{ type: "spring", damping: 20 }}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl opacity-40">🌲</span>
                  </div>
                </motion.div>
                
                <motion.div 
                  className="bg-gradient-to-br from-orange-100 to-orange-200 rounded-2xl relative overflow-hidden group cursor-pointer"
                  whileHover={{ scale: 1.05 }}
                  transition={{ type: "spring", damping: 20 }}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl opacity-40">🌇</span>
                  </div>
                </motion.div>
                
                <motion.div 
                  className="bg-gradient-to-br from-pink-100 to-pink-200 rounded-2xl relative overflow-hidden group cursor-pointer"
                  whileHover={{ scale: 1.05 }}
                  transition={{ type: "spring", damping: 20 }}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl opacity-40">🌸</span>
                  </div>
                </motion.div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Feature callout - Apple style */}
        <motion.div
          className="text-center"
          initial={{ opacity: 1, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          viewport={{ once: true }}
        >
          <p className="text-3xl md:text-4xl font-light text-gray-600 max-w-4xl mx-auto leading-relaxed">
            Your photos stay in <strong className="text-black font-semibold">your</strong> cloud storage.
            <br />
            No scanning. No algorithms. No surprises.
          </p>
        </motion.div>
      </div>
    </section>
  )
}