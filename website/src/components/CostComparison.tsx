'use client'

import { motion } from 'framer-motion'

export default function CostComparison() {

  return (
    <>
      {/* Main Trust Section - Apple Style */}
      <section className="bg-white py-32">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 1, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <h2 className="text-6xl md:text-8xl font-semibold text-black mb-8 leading-none">
              Privacy.
              <br />
              <span className="text-gray-400">Guaranteed.</span>
            </h2>
            <p className="text-3xl md:text-4xl text-gray-600 font-light mb-16 max-w-4xl mx-auto leading-relaxed">
              Your photos never leave your cloud storage.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Comparison Section - Apple Style Integrated */}
      <section className="bg-gray-50 py-32">
        <div className="max-w-7xl mx-auto px-6">
          {/* Question Section */}
          <motion.div
            className="text-center mb-24"
            initial={{ opacity: 1, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <h3 className="text-5xl md:text-6xl font-semibold text-black mb-12 leading-none">
              What happens to
              <br />
              your family photos?
            </h3>
          </motion.div>

          {/* Apple-style integrated comparison */}
          <div className="space-y-8">
            {/* Blaze Gallery - Hero Card */}
            <motion.div
              className="bg-white rounded-3xl p-12 shadow-lg relative overflow-hidden"
              initial={{ opacity: 1, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              viewport={{ once: true }}
            >
              <div className="absolute top-8 right-8 text-6xl opacity-20">🔥</div>
              <div className="max-w-4xl">
                <h4 className="text-4xl md:text-5xl font-semibold text-black mb-6 leading-tight">
                  With Blaze Gallery
                </h4>
                <div className="grid md:grid-cols-2 gap-8 text-xl text-gray-700">
                  <div className="space-y-4">
                    <p className="flex items-center">
                      <span className="text-green-600 text-2xl mr-3">✓</span>
                      Stay in your cloud storage
                    </p>
                    <p className="flex items-center">
                      <span className="text-green-600 text-2xl mr-3">✓</span>
                      Zero photo scanning
                    </p>
                  </div>
                  <div className="space-y-4">
                    <p className="flex items-center">
                      <span className="text-green-600 text-2xl mr-3">✓</span>
                      Open source code
                    </p>
                    <p className="flex items-center">
                      <span className="text-green-600 text-2xl mr-3">✓</span>
                      You control everything
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Versus Others - Side by side */}
            <div className="grid md:grid-cols-2 gap-8">
              <motion.div
                className="bg-white rounded-3xl p-10 relative overflow-hidden"
                initial={{ opacity: 1, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                viewport={{ once: true }}
              >
                <div className="absolute top-6 right-6 text-4xl opacity-20">📷</div>
                <h5 className="text-2xl font-semibold text-black mb-6">Google Photos</h5>
                <div className="space-y-3 text-lg text-red-700">
                  <p className="flex items-center">
                    <span className="text-red-500 text-xl mr-3">⚠️</span>
                    AI scans every photo
                  </p>
                  <p className="flex items-center">
                    <span className="text-red-500 text-xl mr-3">⚠️</span>
                    Builds advertising profiles
                  </p>
                  <p className="flex items-center">
                    <span className="text-red-500 text-xl mr-3">⚠️</span>
                    Your data, their business
                  </p>
                </div>
              </motion.div>

              <motion.div
                className="bg-white rounded-3xl p-10 relative overflow-hidden"
                initial={{ opacity: 1, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                viewport={{ once: true }}
              >
                <div className="absolute top-6 right-6 text-4xl opacity-20">☁️</div>
                <h5 className="text-2xl font-semibold text-black mb-6">iCloud Photos</h5>
                <div className="space-y-3 text-lg text-amber-700">
                  <p className="flex items-center">
                    <span className="text-amber-500 text-xl mr-3">⚠️</span>
                    Apple devices only
                  </p>
                  <p className="flex items-center">
                    <span className="text-amber-500 text-xl mr-3">⚠️</span>
                    Limited sharing
                  </p>
                  <p className="flex items-center">
                    <span className="text-amber-500 text-xl mr-3">⚠️</span>
                    CSAM scanning
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* Final Trust Section */}
      <section className="bg-white py-32">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 1, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <h3 className="text-6xl md:text-8xl font-semibold text-black mb-8 leading-none">
              Trust.
              <br />
              <span className="text-gray-400">Verified.</span>
            </h3>
            <p className="text-3xl md:text-4xl text-gray-600 font-light mb-16 max-w-5xl mx-auto leading-relaxed">
              Open source code you can audit yourself.
            </p>
            <motion.a
              href="https://github.com/sderosiaux/blaze-gallery"
              className="inline-block bg-black text-white px-12 py-4 rounded-full text-xl font-medium hover:bg-gray-800 transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              View Source Code
            </motion.a>
          </motion.div>
        </div>
      </section>
    </>
  )
}