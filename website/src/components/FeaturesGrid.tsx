'use client'

import { motion } from 'framer-motion'

export default function FeaturesGrid() {
  const features = [
    {
      icon: '🔒',
      title: 'Secure by Design',
      description: 'Uses read-only B2 API keys. Your photos never leave your cloud storage. No data mining or scanning.'
    },
    {
      icon: '⚡',
      title: 'Lightning Fast',
      description: 'Smart caching and on-demand thumbnails mean instant photo loading, even for massive collections.'
    },
    {
      icon: '📱',
      title: 'Mobile Ready',
      description: 'Responsive design works perfectly on phones and tablets. Touch-friendly navigation and gestures.'
    },
    {
      icon: '🔗',
      title: 'Secure Sharing',
      description: 'Generate password-protected share links for folders or individual photos. Set expiration dates.'
    },
    {
      icon: '📁',
      title: 'Smart Organization',
      description: 'Preserves your existing folder structure. Navigate thousands of photos with intelligent browsing.'
    },
    {
      icon: '🎲',
      title: 'Photo Discovery',
      description: 'Rediscover forgotten memories with AI-powered random photo suggestions based on dates and patterns.'
    },
    {
      icon: '🐳',
      title: '5-Minute Setup',
      description: 'Deploy with Docker in minutes. Single command gets you running with automatic SSL and updates.'
    },
    {
      icon: '💰',
      title: 'Affordable Storage',
      description: 'Use cost-effective Backblaze B2 storage with transparent per-GB pricing. No subscription tiers or surprise fees.'
    },
    {
      icon: '🔄',
      title: 'Auto Sync',
      description: 'Automatically detects new photos in your B2 bucket. Keep adding photos and they appear instantly.'
    },
    {
      icon: '🎨',
      title: 'RAW Support',
      description: 'Handles professional camera formats. Generates previews for NEF, CR2, ARW, and other RAW files.'
    },
    {
      icon: '👥',
      title: 'Multi-User',
      description: 'Optional Google OAuth integration for team access. Or keep it private for personal use.'
    },
    {
      icon: '🛡️',
      title: 'Privacy First',
      description: 'No telemetry, no tracking, no data collection. Open source code you can audit and trust.'
    }
  ]

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5
      }
    }
  }

  return (
    <section className="py-24 bg-white">
      <div className="container mx-auto px-6 max-w-7xl">
        <motion.div 
          className="text-center mb-20"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
        >
          <h2 className="text-5xl md:text-6xl font-light text-gray-900 mb-8 leading-tight">
            Everything You Need for <br className="hidden sm:block" />
            <span className="bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent font-normal">Photo Management</span>
          </h2>
          <p className="text-xl md:text-2xl text-gray-600 max-w-4xl mx-auto font-light leading-relaxed">
            <span className="text-gray-900 font-medium">Blaze Gallery is 100% free and open source.</span> It combines the best of self-hosted control with Backblaze B2's affordable cloud storage. 
            Here's what makes it special:
          </p>
        </motion.div>

        <motion.div 
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
        >
          {features.map((feature, index) => (
            <motion.div 
              key={index}
              className="group bg-white/80 backdrop-blur-sm border border-gray-200/50 p-8 rounded-2xl hover:bg-white hover:shadow-xl hover:shadow-gray-900/5 transition-all duration-500 cursor-pointer"
              variants={itemVariants}
              whileHover={{ y: -8, transition: { duration: 0.3 } }}
            >
              <div className="text-5xl mb-6 group-hover:scale-110 transition-transform duration-300">{feature.icon}</div>
              <h3 className="text-2xl font-medium text-gray-900 mb-4">{feature.title}</h3>
              <p className="text-gray-600 leading-relaxed font-light text-lg">{feature.description}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Bottom CTA */}
        <motion.div 
          className="text-center mt-20"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          viewport={{ once: true }}
        >
          <div className="bg-gray-50/50 border border-gray-200/50 p-12 rounded-3xl shadow-sm max-w-4xl mx-auto">
            <h3 className="text-4xl md:text-5xl font-light text-gray-900 mb-6 leading-tight">
              Ready to Take Control of <br className="hidden sm:block" />
              <span className="bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent font-normal">Your Photos?</span>
            </h3>
            <p className="text-xl md:text-2xl text-gray-600 mb-8 font-light leading-relaxed max-w-3xl mx-auto">
              Join users who've taken control of their photo storage with transparent pricing and complete privacy.
            </p>
            <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
              <motion.a
                href="https://github.com/sderosiaux/blaze-gallery"
                className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white px-10 py-4 rounded-2xl font-medium text-lg transition-all duration-300 shadow-xl hover:shadow-2xl hover:shadow-orange-500/25"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Get Blaze Gallery
              </motion.a>
              <a
                href="https://github.com/sderosiaux/blaze-gallery"
                className="text-gray-600 hover:text-gray-800 font-medium inline-flex items-center space-x-2 transition-colors text-lg"
              >
                <span>View Source Code</span>
                <span>→</span>
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}