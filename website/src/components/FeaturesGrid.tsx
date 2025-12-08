'use client'

import { motion } from 'framer-motion'

export default function FeaturesGrid() {


  return (
    <>
      {/* Main Features Header - Apple Style */}
      <section className="bg-white py-32">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 1, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <h2 className="text-6xl md:text-8xl font-semibold text-black mb-8 leading-none">
              Powerful.
              <br />
              <span className="text-gray-400">Simple.</span>
            </h2>
          </motion.div>
        </div>
      </section>

      {/* Features Mosaic - Apple Style */}
      <section className="bg-gray-50 py-32">
        <div className="max-w-7xl mx-auto px-6">
          {/* Apple-style Mosaic Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-auto lg:h-[800px]">
            
            {/* Large Feature - Security */}
            <motion.div 
              className="lg:col-span-2 bg-white rounded-3xl p-12 flex flex-col justify-center"
              initial={{ opacity: 1, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              viewport={{ once: true }}
            >
              <div className="text-8xl mb-8">🔒</div>
              <h3 className="text-5xl md:text-6xl font-semibold text-black mb-6 leading-none">
                Your photos
                <br />
                stay yours.
              </h3>
              <p className="text-2xl text-gray-600 font-light leading-relaxed max-w-xl">
                Zero photo scanning. Zero data mining.
                <br />Open source code you can verify.
              </p>
            </motion.div>

            {/* Small Feature - Setup */}
            <motion.div 
              className="bg-black text-white rounded-3xl p-8 flex flex-col justify-center"
              initial={{ opacity: 1, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              viewport={{ once: true }}
            >
              <div className="text-6xl mb-6">🐳</div>
              <h4 className="text-3xl font-semibold mb-4 leading-none">
                5-minute
                <br />setup.
              </h4>
              <p className="text-xl text-gray-300 font-light">
                Docker command.
                <br />You&apos;re live.
              </p>
            </motion.div>

            {/* Medium Feature - Performance */}
            <motion.div 
              className="bg-white rounded-3xl p-10 flex flex-col justify-center"
              initial={{ opacity: 1, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              viewport={{ once: true }}
            >
              <div className="text-7xl mb-6">⚡</div>
              <h4 className="text-4xl font-semibold text-black mb-4 leading-none">
                Lightning
                <br />fast.
              </h4>
              <p className="text-xl text-gray-600 font-light">
                Smart caching. Instant loading.
                <br />Even for massive collections.
              </p>
            </motion.div>

            {/* Medium Feature - Sharing */}
            <motion.div 
              className="bg-white rounded-3xl p-10 flex flex-col justify-center"
              initial={{ opacity: 1, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              viewport={{ once: true }}
            >
              <div className="text-7xl mb-6">🔗</div>
              <h4 className="text-4xl font-semibold text-black mb-4 leading-none">
                Share
                <br />securely.
              </h4>
              <p className="text-xl text-gray-600 font-light">
                Password-protected links.
                <br />Your rules. Your control.
              </p>
            </motion.div>

            {/* Large Feature - No Lock-in */}
            <motion.div
              className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-3xl p-12 flex flex-col justify-center overflow-hidden border border-green-100"
              initial={{ opacity: 1, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.5 }}
              viewport={{ once: true }}
            >
              <div className="text-8xl mb-8">🔓</div>
              <h4 className="text-4xl font-semibold text-black mb-4 leading-none">
                No
                <br />
                lock-in.
              </h4>
              <p className="text-xl text-gray-600 font-light mb-4">
                Backblaze B2, AWS S3,
                <br />Cloudflare R2, MinIO.
              </p>
              <p className="text-sm text-green-600 font-medium">
                Any S3-compatible storage
              </p>
            </motion.div>
            
          </div>

          {/* Additional Feature Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
            
            {/* Mobile Feature */}
            <motion.div 
              className="bg-white rounded-3xl p-10 flex flex-col justify-center"
              initial={{ opacity: 1, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              viewport={{ once: true }}
            >
              <div className="text-7xl mb-6">📱</div>
              <h4 className="text-3xl font-semibold text-black mb-4 leading-none">
                Works everywhere.
              </h4>
              <p className="text-lg text-gray-600 font-light">
                Responsive design. Touch-friendly. Perfect on every device.
              </p>
            </motion.div>

            {/* Open Source Feature */}
            <motion.div 
              className="bg-white rounded-3xl p-10 flex flex-col justify-center"
              initial={{ opacity: 1, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.7 }}
              viewport={{ once: true }}
            >
              <div className="text-7xl mb-6">⭐</div>
              <h4 className="text-3xl font-semibold text-black mb-4 leading-none">
                Open source.
              </h4>
              <p className="text-lg text-gray-600 font-light">
                MIT licensed. Community-driven. Contribute on GitHub.
              </p>
            </motion.div>
            
          </div>
        </div>
      </section>

    </>
  )
}