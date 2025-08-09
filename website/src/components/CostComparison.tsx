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

      {/* Comparison Section - Apple Style */}
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

          {/* Three Column Comparison */}
          <div className="grid md:grid-cols-3 gap-16">
            {/* Blaze Gallery */}
            <motion.div
              className="text-center"
              initial={{ opacity: 1, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              viewport={{ once: true }}
            >
              <div className="text-6xl mb-8">🔥</div>
              <h4 className="text-3xl font-semibold text-black mb-6">Blaze Gallery</h4>
              <div className="space-y-4 text-lg text-gray-700">
                <p>✓ Stay in your cloud storage</p>
                <p>✓ Zero photo scanning</p>
                <p>✓ Open source code</p>
                <p>✓ You control everything</p>
              </div>
            </motion.div>

            {/* Google Photos */}
            <motion.div
              className="text-center"
              initial={{ opacity: 1, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              viewport={{ once: true }}
            >
              <div className="text-6xl mb-8">📷</div>
              <h4 className="text-3xl font-semibold text-black mb-6">Google Photos</h4>
              <div className="space-y-4 text-lg text-red-700">
                <p>⚠️ AI scans every photo</p>
                <p>⚠️ Builds advertising profiles</p>
                <p>⚠️ Your data, their business</p>
                <p>⚠️ Can lock you out anytime</p>
              </div>
            </motion.div>

            {/* iCloud */}
            <motion.div
              className="text-center"
              initial={{ opacity: 1, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              viewport={{ once: true }}
            >
              <div className="text-6xl mb-8">☁️</div>
              <h4 className="text-3xl font-semibold text-black mb-6">iCloud Photos</h4>
              <div className="space-y-4 text-lg text-amber-700">
                <p>⚠️ Apple devices only</p>
                <p>⚠️ Limited sharing</p>
                <p>⚠️ CSAM scanning</p>
                <p>⚠️ Export restrictions</p>
              </div>
            </motion.div>
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