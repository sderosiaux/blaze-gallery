'use client'

import { motion } from 'framer-motion'

export default function InteractiveDemo() {


  return (
    <>
      {/* Get Started - Integrated Apple Style */}
      <section className="bg-white py-32">
        <div className="max-w-7xl mx-auto px-6">
          
          {/* Hero Title */}
          <motion.div
            className="text-center mb-24"
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
            <p className="text-2xl md:text-3xl text-gray-600 font-light max-w-4xl mx-auto leading-relaxed">
              Three simple steps. Your photos, your gallery, your control.
            </p>
          </motion.div>

          {/* Complete Setup Flow - Apple Style */}
          <div className="bg-gray-50 rounded-3xl p-12 shadow-lg">
            
            {/* Step by Step */}
            <div className="space-y-12">
              
              {/* Step 1 - Terminal Setup */}
              <motion.div
                className="bg-white rounded-3xl p-10"
                initial={{ opacity: 1, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.1 }}
                viewport={{ once: true }}
              >
                <div className="flex items-start space-x-8">
                  <div className="text-6xl">1️⃣</div>
                  <div className="flex-1">
                    <h3 className="text-3xl font-semibold text-black mb-4">
                      Clone and setup
                    </h3>
                    <p className="text-xl text-gray-600 mb-6">
                      Get the code and configure your Backblaze B2 credentials
                    </p>
                    <div className="bg-black rounded-2xl p-6">
                      <div className="font-mono text-green-400 space-y-2">
                        <div>git clone https://github.com/sderosiaux/blaze-gallery.git</div>
                        <div>cd blaze-gallery</div>
                        <div className="text-gray-500"># Edit .env to setup your B2 bucket</div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Step 2 - Environment File */}
              <motion.div
                className="bg-white rounded-3xl p-10"
                initial={{ opacity: 1, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                viewport={{ once: true }}
              >
                <div className="flex items-start space-x-8">
                  <div className="text-6xl">2️⃣</div>
                  <div className="flex-1">
                    <h3 className="text-3xl font-semibold text-black mb-4">
                      Add your B2 credentials
                    </h3>
                    <p className="text-xl text-gray-600 mb-6">
                      Create a .env file with your Backblaze B2 storage details
                    </p>
                    <div className="bg-black rounded-2xl p-6">
                      <div className="font-mono text-green-400 text-sm space-y-1">
                        <div>B2_APPLICATION_KEY_ID=your_key_id</div>
                        <div>B2_APPLICATION_KEY=your_key</div>
                        <div>B2_BUCKET_NAME=your_bucket_name</div>
                        <div className="text-gray-500"># Get these from your B2 dashboard</div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Step 3 - Launch */}
              <motion.div
                className="bg-black text-white rounded-3xl p-10"
                initial={{ opacity: 1, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                viewport={{ once: true }}
              >
                <div className="flex items-start space-x-8">
                  <div className="text-6xl">🎉</div>
                  <div className="flex-1">
                    <h3 className="text-3xl font-semibold mb-4">
                      Launch your gallery
                    </h3>
                    <p className="text-xl text-gray-300 mb-6">
                      Start the development server and enjoy your private photo gallery
                    </p>
                    <div className="bg-gray-900 rounded-2xl p-6">
                      <div className="font-mono text-green-400 space-y-2">
                        <div>npm run dev</div>
                        <div className="text-gray-500"># Open localhost:3000 - Done! 🚀</div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Demo Section */}
      <section className="bg-gray-50 py-32">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-24">
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
              <p className="text-2xl md:text-3xl text-gray-600 font-light max-w-4xl mx-auto leading-relaxed">
                Real scenarios. Real benefits. Your photos, your way.
              </p>
            </motion.div>
          </div>

          {/* Scenario Cards */}
          <div className="space-y-16">
            
            {/* Scenario 1: Family Photos */}
            <motion.div
              className="bg-white rounded-3xl p-12 shadow-lg"
              initial={{ opacity: 1, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              viewport={{ once: true }}
            >
              <div className="grid lg:grid-cols-2 gap-12 items-center">
                <div>
                  <div className="text-6xl mb-6">👨‍👩‍👧‍👦</div>
                  <h4 className="text-3xl font-semibold text-black mb-6">
                    &quot;Finally, our family photos are safe and private&quot;
                  </h4>
                  <p className="text-xl text-gray-600 mb-8 leading-relaxed">
                    Sarah moved her 10,000+ family photos from Google Photos to Blaze Gallery. 
                    Now she controls who sees her children&apos;s photos, with secure sharing links 
                    and no AI scanning their precious memories.
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-center text-lg text-gray-700">
                      <span className="text-green-600 text-xl mr-3">✓</span>
                      10,000+ photos organized by years and events
                    </div>
                    <div className="flex items-center text-lg text-gray-700">
                      <span className="text-green-600 text-xl mr-3">✓</span>
                      Secure sharing with grandparents
                    </div>
                    <div className="flex items-center text-lg text-gray-700">
                      <span className="text-green-600 text-xl mr-3">✓</span>
                      Zero AI scanning or data mining
                    </div>
                  </div>
                </div>
                <div className="bg-gray-900 rounded-2xl p-6">
                  <div className="bg-gray-800 rounded-lg p-4 mb-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      <span className="text-gray-400 text-sm ml-3">family.gallery.com</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-blue-200 rounded-lg p-3 text-center">
                      <div className="text-2xl mb-1">📸</div>
                      <div className="text-xs text-gray-700">2024-vacation</div>
                    </div>
                    <div className="bg-green-200 rounded-lg p-3 text-center">
                      <div className="text-2xl mb-1">🎂</div>
                      <div className="text-xs text-gray-700">birthdays</div>
                    </div>
                    <div className="bg-purple-200 rounded-lg p-3 text-center">
                      <div className="text-2xl mb-1">🏖️</div>
                      <div className="text-xs text-gray-700">summer-2023</div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Scenario 2: Professional Photographer */}
            <motion.div
              className="bg-black text-white rounded-3xl p-12"
              initial={{ opacity: 1, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              viewport={{ once: true }}
            >
              <div className="grid lg:grid-cols-2 gap-12 items-center">
                <div className="bg-gray-900 rounded-2xl p-6">
                  <div className="bg-gray-800 rounded-lg p-4 mb-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      <span className="text-gray-400 text-sm ml-3">studio.photos.com</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="bg-gradient-to-r from-orange-200 to-red-200 rounded-lg p-4">
                      <div className="text-lg font-semibold text-gray-800">Wedding - Johnson</div>
                      <div className="text-sm text-gray-600">2,847 RAW files • 45GB</div>
                    </div>
                    <div className="bg-gradient-to-r from-blue-200 to-purple-200 rounded-lg p-4">
                      <div className="text-lg font-semibold text-gray-800">Corporate - TechCorp</div>
                      <div className="text-sm text-gray-600">1,234 images • 12GB</div>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-6xl mb-6">📷</div>
                  <h4 className="text-3xl font-semibold mb-6">
                    &quot;My clients love the secure sharing&quot;
                  </h4>
                  <p className="text-xl text-gray-300 mb-8 leading-relaxed">
                    Marcus runs a photography studio and uses Blaze Gallery to share high-res 
                    proofs with clients. Password-protected albums and direct B2 storage 
                    keeps costs low while maintaining professional quality.
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-center text-lg text-gray-300">
                      <span className="text-green-400 text-xl mr-3">✓</span>
                      RAW file support for professional workflows
                    </div>
                    <div className="flex items-center text-lg text-gray-300">
                      <span className="text-green-400 text-xl mr-3">✓</span>
                      Password-protected client galleries
                    </div>
                    <div className="flex items-center text-lg text-gray-300">
                      <span className="text-green-400 text-xl mr-3">✓</span>
                      $0.005/GB storage cost with B2
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Scenario 3: Privacy-Conscious User */}
            <motion.div
              className="bg-white rounded-3xl p-12 shadow-lg"
              initial={{ opacity: 1, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              viewport={{ once: true }}
            >
              <div className="grid lg:grid-cols-2 gap-12 items-center">
                <div>
                  <div className="text-6xl mb-6">🔐</div>
                  <h4 className="text-3xl font-semibold text-black mb-6">
                    &quot;No more scanning my private moments&quot;
                  </h4>
                  <p className="text-xl text-gray-600 mb-8 leading-relaxed">
                    Alex was concerned about AI companies training on personal photos. 
                    With Blaze Gallery, photos stay in their own B2 bucket with zero 
                    third-party access or algorithmic processing.
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-center text-lg text-gray-700">
                      <span className="text-green-600 text-xl mr-3">✓</span>
                      Photos never leave your storage
                    </div>
                    <div className="flex items-center text-lg text-gray-700">
                      <span className="text-green-600 text-xl mr-3">✓</span>
                      Open source - audit the code yourself
                    </div>
                    <div className="flex items-center text-lg text-gray-700">
                      <span className="text-green-600 text-xl mr-3">✓</span>
                      Self-hosted - you control everything
                    </div>
                  </div>
                </div>
                <div className="bg-gray-100 rounded-2xl p-6">
                  <div className="text-center mb-6">
                    <div className="text-4xl mb-2">🛡️</div>
                    <div className="text-lg font-semibold text-gray-800">Your Data Stays Yours</div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-2 border-b border-gray-200">
                      <span className="text-gray-600">AI Training</span>
                      <span className="text-red-600 font-semibold">❌ Never</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-200">
                      <span className="text-gray-600">Data Mining</span>
                      <span className="text-red-600 font-semibold">❌ Never</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-200">
                      <span className="text-gray-600">Ads/Tracking</span>
                      <span className="text-red-600 font-semibold">❌ Never</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-gray-600">Your Control</span>
                      <span className="text-green-600 font-semibold">✅ Always</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </>
  )
}