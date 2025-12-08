'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const keyQuestions = [
  {
    question: 'Can I trust Blaze Gallery with my family photos?',
    answer: 'Your photos never leave your Backblaze B2 storage. Blaze Gallery is 100% open source - you can audit every line of code yourself. The software runs on YOUR server. We can\'t access, scan, or analyze your photos because they\'re stored in YOUR account, not ours.'
  },
  {
    question: 'Is it really just 5 minutes to set up?',
    answer: 'Yes! The mandatory step is creating your .env file with B2 credentials (B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME). Then: git clone, cd blaze-gallery, npm install, npm run dev. Open localhost:3000 and click sync. The B2 account setup takes 2 minutes, the rest is copy-paste.'
  },
  {
    question: 'Can it handle large photo collections?',
    answer: 'Absolutely. Users successfully run Blaze Gallery with 50,000+ photos and hundreds of GB. Smart caching, on-demand thumbnail generation, and efficient database indexing mean it stays fast regardless of collection size.'
  },
  {
    question: 'Do I need technical skills to run this?',
    answer: 'If you can copy-paste commands, you can run Blaze Gallery. The Docker setup handles all the complexity. No need to understand databases, server configuration, or networking. Just provide your B2 credentials and go.'
  }
]

export default function FAQ() {
  const [openQuestion, setOpenQuestion] = useState<number | null>(null)

  return (
    <>
      {/* Main Questions Header - Apple Style */}
      <section className="bg-white py-32">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 1, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <h2 className="text-6xl md:text-8xl font-semibold text-black mb-8 leading-none">
              Questions?
              <br />
              <span className="text-gray-400">Answers.</span>
            </h2>
          </motion.div>
        </div>
      </section>

      {/* Key Questions - Apple Style */}
      <section className="bg-gray-50 py-32">
        <div className="max-w-6xl mx-auto px-6 space-y-24">
          
          {/* Interactive Questions */}
          <div className="max-w-4xl mx-auto space-y-8">
            {keyQuestions.map((item, index) => (
              <motion.div
                key={index}
                className="bg-white rounded-3xl overflow-hidden shadow-sm"
                initial={{ opacity: 1, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: index * 0.1 }}
                viewport={{ once: true }}
              >
                <button
                  onClick={() => setOpenQuestion(openQuestion === index ? null : index)}
                  className="w-full px-10 py-8 text-left hover:bg-gray-50 transition-all duration-300 flex justify-between items-center group"
                >
                  <h3 className="text-3xl md:text-4xl font-semibold text-black pr-4 group-hover:text-gray-700 transition-colors leading-tight">
                    {item.question}
                  </h3>
                  <motion.span 
                    className="text-4xl text-black font-light"
                    animate={{ rotate: openQuestion === index ? 45 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    +
                  </motion.span>
                </button>
                <AnimatePresence>
                  {openQuestion === index && (
                    <motion.div 
                      className="px-10 py-8 bg-gray-50 border-t border-gray-200"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    >
                      <p className="text-xl md:text-2xl text-gray-700 leading-relaxed font-light">
                        {item.answer}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>

        </div>
      </section>

      {/* More Questions CTA */}
      <section className="bg-white py-32">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 1, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <h3 className="text-5xl md:text-6xl font-semibold text-black mb-8 leading-none">
              More questions?
            </h3>
            <p className="text-2xl md:text-3xl text-gray-600 font-light mb-12 leading-relaxed">
              Check the documentation or ask on GitHub.
              <br />We&apos;re here to help.
            </p>
            <div className="flex flex-col sm:flex-row gap-6 justify-center">
              <motion.a
                href="https://github.com/sderosiaux/blaze-gallery/blob/main/README.md"
                className="bg-black text-white px-10 py-4 rounded-full text-xl font-medium hover:bg-gray-800 transition-colors"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Read Documentation
              </motion.a>
              <motion.a
                href="https://github.com/sderosiaux/blaze-gallery/discussions"
                className="border border-black text-black px-10 py-4 rounded-full text-xl font-medium hover:bg-black hover:text-white transition-colors"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Ask on GitHub
              </motion.a>
            </div>
          </motion.div>
        </div>
      </section>
    </>
  )
}