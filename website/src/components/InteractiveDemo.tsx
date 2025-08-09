'use client'

import { motion } from 'framer-motion'

export default function InteractiveDemo() {


  return (
    <>
      {/* Get Started - Apple Style */}
      <section className="bg-white py-32">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 1, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <h2 className="text-6xl md:text-8xl font-semibold text-black mb-8 leading-none">
              Get started
              <br />
              <span className="text-gray-400">in minutes.</span>
            </h2>
          </motion.div>
        </div>
      </section>

      {/* Setup Steps - Apple Mosaic Style */}
      <section className="bg-gray-50 py-32">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-auto lg:h-[700px]">
            
            {/* Large Step - Create .env */}
            <motion.div 
              className="bg-white rounded-3xl p-12 flex flex-col justify-center"
              initial={{ opacity: 1, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              viewport={{ once: true }}
            >
              <div className="text-8xl mb-8">⚙️</div>
              <h3 className="text-5xl md:text-6xl font-semibold text-black mb-6 leading-none">
                Create
                <br />
                .env file.
              </h3>
              <div className="bg-black rounded-2xl p-6 text-left">
                <div className="font-mono text-green-400 text-sm space-y-1">
                  <div>B2_APPLICATION_KEY_ID=your_key_id</div>
                  <div>B2_APPLICATION_KEY=your_key</div>
                  <div>B2_BUCKET_NAME=your_bucket_name</div>
                  <div className="text-gray-500"># That's all you need</div>
                </div>
              </div>
            </motion.div>

            {/* Steps Grid */}
            <div className="space-y-8">
              
              {/* Step 1 - Clone */}
              <motion.div 
                className="bg-black text-white rounded-3xl p-8"
                initial={{ opacity: 1, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                viewport={{ once: true }}
              >
                <div className="text-5xl mb-4">💾</div>
                <h4 className="text-3xl font-semibold mb-4 leading-none">
                  Clone.
                </h4>
                <div className="font-mono text-green-400 text-sm">
                  git clone https://github.com/sderosiaux/blaze-gallery.git
                </div>
              </motion.div>

              {/* Step 2 - Run */}
              <motion.div 
                className="bg-white rounded-3xl p-8"
                initial={{ opacity: 1, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                viewport={{ once: true }}
              >
                <div className="text-5xl mb-4">🚀</div>
                <h4 className="text-3xl font-semibold text-black mb-4 leading-none">
                  Launch.
                </h4>
                <div className="font-mono text-sm text-gray-700 space-y-1">
                  <div>npm install</div>
                  <div>npm run dev</div>
                  <div className="text-gray-500"># Open localhost:3000</div>
                </div>
              </motion.div>
              
            </div>
          </div>
        </div>
      </section>

      {/* Live Demo Section */}
      <section className="bg-white py-32">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <motion.div
              initial={{ opacity: 1, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
            >
              <h3 className="text-5xl md:text-6xl font-semibold text-black mb-8 leading-none">
                See it
                <br />
                in action.
              </h3>
            </motion.div>
          </div>

          {/* Browser Mockup */}
          <motion.div
            className="relative mx-auto max-w-5xl"
            initial={{ opacity: 1, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, ease: [0.25, 0.1, 0.25, 1] }}
            viewport={{ once: true }}
          >
            <div className="bg-white rounded-3xl shadow-2xl shadow-black/20 border border-gray-200">
              {/* Browser Chrome */}
              <div className="bg-gray-50 rounded-t-3xl px-8 py-6 border-b border-gray-200">
                <div className="flex items-center space-x-3">
                  <div className="flex space-x-2">
                    <div className="w-4 h-4 bg-red-500 rounded-full"></div>
                    <div className="w-4 h-4 bg-yellow-500 rounded-full"></div>
                    <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                  </div>
                  <div className="flex-1 bg-white rounded-lg px-4 py-2 text-gray-500 font-mono text-sm">
                    gallery.yourdomain.com
                  </div>
                </div>
              </div>
              
              {/* Gallery Interface */}
              <div className="p-12">
                <div className="grid grid-cols-6 gap-4 h-80">
                  {/* Folder thumbnails */}
                  <motion.div 
                    className="col-span-2 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl p-4 flex flex-col justify-between"
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", damping: 20 }}
                  >
                    <div className="text-2xl">📁</div>
                    <div className="text-sm font-medium">vacation-2024</div>
                  </motion.div>
                  
                  <motion.div 
                    className="bg-gradient-to-br from-green-100 to-green-200 rounded-2xl p-4 flex flex-col justify-between"
                    whileHover={{ scale: 1.05 }}
                    transition={{ type: "spring", damping: 20 }}
                  >
                    <div className="text-xl">🌄</div>
                    <div className="text-xs font-medium">nature</div>
                  </motion.div>
                  
                  <motion.div 
                    className="bg-gradient-to-br from-purple-100 to-purple-200 rounded-2xl p-4 flex flex-col justify-between"
                    whileHover={{ scale: 1.05 }}
                    transition={{ type: "spring", damping: 20 }}
                  >
                    <div className="text-xl">🎉</div>
                    <div className="text-xs font-medium">events</div>
                  </motion.div>
                  
                  <motion.div 
                    className="bg-gradient-to-br from-orange-100 to-orange-200 rounded-2xl p-4 flex flex-col justify-between"
                    whileHover={{ scale: 1.05 }}
                    transition={{ type: "spring", damping: 20 }}
                  >
                    <div className="text-xl">👶</div>
                    <div className="text-xs font-medium">family</div>
                  </motion.div>
                  
                  <motion.div 
                    className="bg-gradient-to-br from-pink-100 to-pink-200 rounded-2xl p-4 flex flex-col justify-between"
                    whileHover={{ scale: 1.05 }}
                    transition={{ type: "spring", damping: 20 }}
                  >
                    <div className="text-xl">📷</div>
                    <div className="text-xs font-medium">misc</div>
                  </motion.div>
                  
                  <motion.div 
                    className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl p-4 flex flex-col justify-between"
                    whileHover={{ scale: 1.05 }}
                    transition={{ type: "spring", damping: 20 }}
                  >
                    <div className="text-xl">🎨</div>
                    <div className="text-xs font-medium">art</div>
                  </motion.div>
                  
                  {/* More folder rows */}
                  <motion.div 
                    className="col-span-3 bg-gradient-to-br from-teal-100 to-teal-200 rounded-2xl p-4 flex flex-col justify-between"
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", damping: 20 }}
                  >
                    <div className="text-3xl">🏠</div>
                    <div className="text-sm font-medium">home-projects</div>
                  </motion.div>
                  
                  <motion.div 
                    className="col-span-3 bg-gradient-to-br from-yellow-100 to-yellow-200 rounded-2xl p-4 flex flex-col justify-between"
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", damping: 20 }}
                  >
                    <div className="text-3xl">🏞️</div>
                    <div className="text-sm font-medium">landscapes</div>
                  </motion.div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </>
  )
}