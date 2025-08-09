'use client'

import { motion } from 'framer-motion'

interface PhotoService {
  name: string
  logo: string
  color: string
  tagline: string
  privacy: 'full' | 'limited' | 'none'
  control: 'complete' | 'limited' | 'none'
  features: string[]
  whatTheyDo: string[]
  trustLevel: 'high' | 'medium' | 'low'
}

const photoServices: PhotoService[] = [
  {
    name: 'Blaze Gallery',
    logo: '🔥',
    color: 'blaze',
    tagline: 'Your photos, your server, your rules',
    privacy: 'full',
    control: 'complete',
    trustLevel: 'high',
    features: [
      '100% free and open source',
      'No photo scanning or AI analysis',
      'Complete privacy - photos never leave your storage',
      'Unlimited sharing with anyone',
      'No file count or user limits',
      'Advanced folder organization',
      'Password-protected sharing',
      'Self-hosted - you control everything'
    ],
    whatTheyDo: [
      'You know exactly where your photos are stored',
      'Open source code you can audit yourself',
      'No mystery algorithms or data mining',
      'Your family memories stay private forever'
    ]
  },
  {
    name: 'Google Photos',
    logo: '📷',
    color: 'blue',
    tagline: 'Convenient, but at what cost?',
    privacy: 'none',
    control: 'limited',
    trustLevel: 'low',
    features: [
      'Easy setup and sync',
      'Automatic face recognition',
      'AI-powered search',
      'Mobile app included'
    ],
    whatTheyDo: [
      'Scans every photo with AI for advertising data',
      'Builds detailed profiles of your family',
      'Can remove access to your photos anytime',
      'Terms of service change without notice',
      'Your intimate moments become their data'
    ]
  },
  {
    name: 'iCloud Photos',
    logo: '☁️',
    color: 'gray',
    tagline: 'Locked into Apple\'s ecosystem',
    privacy: 'limited',
    control: 'limited',
    trustLevel: 'medium',
    features: [
      'Seamless Apple device sync',
      'Family sharing options',
      'Good privacy reputation'
    ],
    whatTheyDo: [
      'Locks you into Apple devices only',
      'Limited sharing with non-Apple users',
      'Can scan photos for illegal content (CSAM)',
      'Apple controls access to your memories',
      'Difficult to export your photos elsewhere'
    ]
  }
]

export default function CostComparison() {
  const getColorClasses = (color: string, isRecommended = false) => {
    switch (color) {
      case 'blaze':
        return isRecommended 
          ? 'border-orange-200 shadow-2xl shadow-orange-500/10 ring-2 ring-orange-200' 
          : 'border-orange-200 hover:border-orange-300'
      case 'blue':
        return 'border-gray-200 hover:border-blue-300'
      case 'gray':
        return 'border-gray-200 hover:border-gray-300'
      default:
        return 'border-gray-200 hover:border-gray-300'
    }
  }

  const getTrustBadge = (trustLevel: string, privacy: string) => {
    if (trustLevel === 'high' && privacy === 'full') {
      return (
        <div className="inline-flex items-center px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium border border-emerald-200">
          <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2 animate-pulse"></span>
          Complete Trust
        </div>
      )
    } else if (trustLevel === 'medium') {
      return (
        <div className="inline-flex items-center px-4 py-2 bg-amber-50 text-amber-700 rounded-full text-sm font-medium border border-amber-200">
          <span className="w-2 h-2 bg-amber-500 rounded-full mr-2"></span>
          Limited Trust
        </div>
      )
    } else {
      return (
        <div className="inline-flex items-center px-4 py-2 bg-red-50 text-red-700 rounded-full text-sm font-medium border border-red-200">
          <span className="w-2 h-2 bg-red-500 rounded-full mr-2 animate-pulse"></span>
          Privacy Risk
        </div>
      )
    }
  }

  const fadeInUp = {
    initial: { opacity: 0, y: 40 },
    whileInView: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: "easeOut" }
  }

  const staggerChildren = {
    initial: { opacity: 0 },
    whileInView: { opacity: 1 },
    transition: {
      staggerChildren: 0.2
    }
  }

  return (
    <section id="privacy" className="py-24 bg-gray-50/50">
      <div className="container mx-auto px-6 max-w-7xl">
        <motion.div 
          className="text-center mb-20" 
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
        >
          <h2 className="text-5xl md:text-6xl font-light text-gray-900 mb-8 leading-tight">
            Your Family Photos <br className="hidden sm:block" />
            <span className="bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent font-normal">Deserve Better</span>
          </h2>
          <p className="text-xl md:text-2xl text-gray-600 max-w-4xl mx-auto mb-12 font-light leading-relaxed">
            Your memories are precious and private. <span className="text-gray-900 font-medium">Blaze Gallery is 100% free and open source</span> - 
            compare what happens to your family photos and who really controls them.
          </p>
          
          <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 p-8 rounded-2xl max-w-4xl mx-auto shadow-sm">
            <h3 className="text-xl font-medium text-gray-900 mb-4">The Real Question Isn't Price</h3>
            <p className="text-gray-600 text-lg font-light leading-relaxed">
              It's: <em>"Do I trust this company with my most intimate family moments? 
              Do I know what they do with my photos? Can they lock me out tomorrow?"</em>
            </p>
          </div>
        </motion.div>

        {/* Privacy Comparison Cards */}
        <motion.div 
          className="grid lg:grid-cols-3 gap-8 max-w-7xl mx-auto"
          variants={staggerChildren}
          initial="initial"
          whileInView="whileInView"
          viewport={{ once: true, margin: "-100px" }}
        >
          {photoServices.map((service, index) => {
            const isRecommended = service.color === 'blaze'
            
            return (
              <motion.div 
                key={service.name}
                className={`relative p-8 rounded-2xl border transition-all duration-500 bg-white/80 backdrop-blur-sm hover:bg-white hover:shadow-xl hover:-translate-y-2 ${getColorClasses(service.color, isRecommended)}`}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1, duration: 0.6 }}
                viewport={{ once: true }}
                whileHover={{ y: -8, transition: { duration: 0.3 } }}
              >
                {isRecommended && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <span className="bg-gradient-to-r from-orange-500 to-red-600 text-white px-6 py-2 rounded-full text-sm font-medium shadow-lg">
                      ⭐ Recommended
                    </span>
                  </div>
                )}
                
                {/* Header */}
                <div className="text-center mb-6">
                  <div className="text-4xl mb-4">{service.logo}</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">{service.name}</h3>
                  <p className="text-gray-600 font-medium mb-3">{service.tagline}</p>
                  {getTrustBadge(service.trustLevel, service.privacy)}
                </div>

                {/* What you get */}
                <div className="mb-6">
                  <h4 className="font-semibold text-gray-900 mb-3">What you get:</h4>
                  <ul className="space-y-2">
                    {service.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start text-sm text-gray-700">
                        <span className="text-green-500 mr-2 mt-0.5">✓</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* What they do with your photos */}
                <div className="mb-6">
                  <h4 className="font-semibold text-gray-900 mb-3">
                    {service.color === 'blaze' ? 'Why you can trust us:' : 'What happens to your photos:'}
                  </h4>
                  <ul className="space-y-2">
                    {service.whatTheyDo.map((item, idx) => (
                      <li key={idx} className="flex items-start text-sm">
                        <span className={`mr-2 mt-0.5 ${
                          service.color === 'blaze' ? 'text-green-500' : 'text-red-500'
                        }`}>
                          {service.color === 'blaze' ? '🛡️' : '⚠️'}
                        </span>
                        <span className={service.color === 'blaze' ? 'text-gray-700' : 'text-red-700'}>
                          {item}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* CTA */}
                <div className="pt-6 border-t border-gray-200">
                  {isRecommended ? (
                    <motion.a
                      href="https://github.com/sderosiaux/blaze-gallery"
                      className="w-full bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white py-3 px-6 rounded-xl font-medium text-center block transition-all duration-300 shadow-lg hover:shadow-xl"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Get Blaze Gallery →
                    </motion.a>
                  ) : (
                    <div className="text-center">
                      <div className="text-sm text-gray-500 italic">
                        "Convenient, but your family photos become their business data"
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )
          })}
        </motion.div>

        {/* Bottom CTA */}
        <motion.div 
          className="text-center mt-20"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
        >
          <div className="bg-gradient-to-r from-gray-50 to-white p-12 rounded-3xl max-w-5xl mx-auto border border-gray-200/50 shadow-sm">
            <h3 className="text-4xl md:text-5xl font-light text-gray-900 mb-6 leading-tight">
              Your Memories. Your Server. <br className="hidden sm:block" />
              <span className="bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">Your Peace of Mind.</span>
            </h3>
            <p className="text-xl md:text-2xl text-gray-600 mb-8 leading-relaxed font-light max-w-4xl mx-auto">
              Stop wondering what happens to your family photos behind closed doors. 
              With Blaze Gallery, you know exactly where they are, who can see them, and that they'll always be yours.
            </p>
            <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
              <motion.a
                href="https://github.com/sderosiaux/blaze-gallery"
                className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white px-10 py-4 rounded-2xl font-medium text-lg transition-all duration-300 shadow-xl hover:shadow-2xl hover:shadow-orange-500/25"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Get Blaze Gallery →
              </motion.a>
              <div className="flex items-center text-gray-600 text-lg">
                <span className="mr-3 text-xl">🔓</span>
                <span className="font-light">100% Free & Open Source</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}