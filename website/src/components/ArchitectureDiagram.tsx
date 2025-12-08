'use client'

import { motion } from 'framer-motion'

export default function ArchitectureDiagram() {

  return (
    <>
      {/* How It Works - Apple Style */}
      <section className="bg-white py-32">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 1, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <h2 className="text-6xl md:text-8xl font-semibold text-black mb-8 leading-none">
              How it
              <br />
              <span className="text-gray-400">works.</span>
            </h2>
          </motion.div>
        </div>
      </section>

      {/* Apple-style Process Mosaic */}
      <section className="bg-gray-50 py-32">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-auto lg:h-[600px]">
            
            {/* Large Step - Your Cloud */}
            <motion.div 
              className="bg-white rounded-3xl p-12 flex flex-col justify-center"
              initial={{ opacity: 1, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              viewport={{ once: true }}
            >
              <div className="text-8xl mb-8">☁️</div>
              <h3 className="text-5xl md:text-6xl font-semibold text-black mb-6 leading-none">
                Your photos
                <br />
                stay put.
              </h3>
              <p className="text-2xl text-gray-600 font-light leading-relaxed max-w-lg">
                Upload to your Backblaze B2 storage.
                <br />They never leave your account.
              </p>
            </motion.div>

            {/* Steps Grid */}
            <div className="space-y-8">
              
              {/* Step 1 - Connect */}
              <motion.div 
                className="bg-black text-white rounded-3xl p-8"
                initial={{ opacity: 1, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                viewport={{ once: true }}
              >
                <div className="text-5xl mb-4">🔗</div>
                <h4 className="text-3xl font-semibold mb-4 leading-none">
                  Connect.
                </h4>
                <p className="text-xl text-gray-300 font-light">
                  Add your B2 credentials.
                  <br />Read-only access.
                </p>
              </motion.div>

              {/* Step 2 - Sync */}
              <motion.div 
                className="bg-white rounded-3xl p-8"
                initial={{ opacity: 1, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                viewport={{ once: true }}
              >
                <div className="text-5xl mb-4">⚡</div>
                <h4 className="text-3xl font-semibold text-black mb-4 leading-none">
                  Browse.
                </h4>
                <p className="text-xl text-gray-600 font-light">
                  Smart caching.
                  <br />Instant thumbnails.
                </p>
              </motion.div>
              
            </div>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section className="bg-white py-32">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 1, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
            >
              <h3 className="text-5xl md:text-6xl font-semibold text-black mb-8 leading-none">
                Your data
                <br />
                never moves.
              </h3>
              <p className="text-2xl text-gray-600 font-light leading-relaxed">
                Blaze Gallery only reads from your B2 storage.
                <br />No copying. No storing elsewhere.
              </p>
            </motion.div>
            
            <motion.div
              className="text-center"
              initial={{ opacity: 1, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              viewport={{ once: true }}
            >
              <div className="text-9xl mb-8">🔒</div>
              <h4 className="text-4xl font-semibold text-black mb-4">
                Read-only access.
              </h4>
              <p className="text-xl text-gray-600 font-light">
                Can&apos;t delete. Can&apos;t modify.
                <br />
                Only view and share.
              </p>
            </motion.div>
          </div>
        </div>
      </section>
    </>
  )
}