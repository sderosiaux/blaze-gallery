'use client'

import { useState } from 'react'

interface FAQItem {
  question: string
  answer: string
  category: 'setup' | 'cost' | 'technical' | 'security'
}

const faqs: FAQItem[] = [
  {
    question: 'Why should I trust Blaze Gallery with my family photos?',
    answer: 'Blaze Gallery is 100% open source - you can audit every line of code yourself. Your photos never leave your own Backblaze B2 storage. We can\'t access, scan, or analyze your photos because they\'re stored in YOUR account, not ours. The software runs on YOUR server. There\'s no mystery about what happens to your memories.',
    category: 'security'
  },
  {
    question: 'Is it really just 5 minutes to set up?',
    answer: 'Yes! If you already have Docker installed, it\'s literally: 1) Copy your B2 credentials to .env, 2) Run "docker-compose up -d", 3) Open localhost:3000, 4) Click sync. The hardest part is creating your Backblaze B2 account, which takes about 2 minutes.',
    category: 'setup'
  },
  {
    question: 'What happens to my photos if I stop using Blaze Gallery?',
    answer: 'Your photos remain safely in your Backblaze B2 account, exactly where you put them. Blaze Gallery never moves or modifies your original photos. You can download them directly from B2, use another app, or restart Blaze Gallery anytime.',
    category: 'security'
  },
  {
    question: 'Can it handle large photo collections?',
    answer: 'Absolutely. Users successfully run Blaze Gallery with 50,000+ photos and hundreds of GB. Smart caching, on-demand thumbnail generation, and efficient database indexing mean it stays fast regardless of collection size.',
    category: 'technical'
  },
  {
    question: 'Do I need technical skills to run this?',
    answer: 'If you can copy-paste a few commands, you can run Blaze Gallery. The Docker setup handles all the complexity. No need to understand databases, server configuration, or networking. Just provide your B2 credentials and go.',
    category: 'setup'
  },
  {
    question: 'Is my data secure? Can you access my photos?',
    answer: 'Your photos never leave your Backblaze account. Blaze Gallery uses read-only API keys, so it can\'t delete or modify anything. Since you self-host it, there\'s no central server for anyone to access. The code is open source for full transparency.',
    category: 'security'
  },
  {
    question: 'What exactly does Google Photos do with my family photos?',
    answer: 'Google scans every photo with AI to build advertising profiles. They analyze faces, objects, locations, and activities to understand your family\'s life patterns. This data helps them target ads and build their AI models. While convenient, your intimate family moments become their business intelligence.',
    category: 'security'
  },
  {
    question: 'Can I really share unlimited photos with Blaze Gallery?',
    answer: 'Yes! Create password-protected share links for any folder or individual photos. No limits on recipients, no expiration unless you set one, no restrictions on download counts. Share wedding albums with hundreds of guests, or create family links that work forever. Your sharing, your rules.',
    category: 'setup'
  },
  {
    question: 'Can I share photos with family who aren\'t technical?',
    answer: 'Yes! Generate password-protected share links that work in any browser. Recipients just visit the link, enter the password, and can view/download photos. No account needed. Links can expire automatically for security.',
    category: 'setup'
  },
  {
    question: 'Does it work on mobile devices?',
    answer: 'Perfectly. The interface is responsive and touch-friendly. You can browse, view, and share photos from phones and tablets. Progressive image loading ensures fast performance even on slower mobile connections.',
    category: 'technical'
  },
  {
    question: 'What if Backblaze B2 shuts down or changes pricing?',
    answer: 'Your photos are stored in standard formats and can be downloaded anytime. B2 is S3-compatible, so you can migrate to AWS S3, Google Cloud, or any compatible provider with minimal changes to Blaze Gallery configuration.',
    category: 'security'
  },
  {
    question: 'Can I add new photos without re-syncing everything?',
    answer: 'Yes. Just upload new photos to your B2 bucket (using Backblaze web interface, B2 CLI, or any tool). Blaze Gallery automatically detects and processes new/changed files when you refresh the page, keeping sync fast even with large collections.',
    category: 'technical'
  },
  {
    question: 'Do you offer support or is this just a side project?',
    answer: 'Blaze Gallery is actively maintained open source software. GitHub Issues provide community support, documentation covers common scenarios, and the codebase is clean and well-commented for troubleshooting.',
    category: 'setup'
  }
]

export default function FAQ() {
  const [openFAQ, setOpenFAQ] = useState<number | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('all')

  const categories = [
    { id: 'all', name: 'All Questions', icon: '💭' },
    { id: 'setup', name: 'Setup & Usage', icon: '🚀' },
    { id: 'cost', name: 'Cost & Pricing', icon: '💰' },
    { id: 'technical', name: 'Technical', icon: '⚙️' },
    { id: 'security', name: 'Security & Privacy', icon: '🔒' }
  ]

  const filteredFAQs = activeCategory === 'all' 
    ? faqs 
    : faqs.filter(faq => faq.category === activeCategory)

  return (
    <section className="py-20 bg-white">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            Frequently Asked Questions
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Everything you need to know about Blaze Gallery, from setup to security. 
            Still have questions? Ask on GitHub or join our community.
          </p>
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap justify-center gap-3 mb-12">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              className={`px-4 py-2 rounded-full transition-all ${
                activeCategory === category.id
                  ? 'bg-blaze-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span className="mr-2">{category.icon}</span>
              {category.name}
            </button>
          ))}
        </div>

        {/* FAQ List */}
        <div className="max-w-4xl mx-auto">
          {filteredFAQs.map((faq, index) => (
            <div 
              key={index}
              className="border border-gray-200 rounded-lg mb-4 overflow-hidden"
            >
              <button
                onClick={() => setOpenFAQ(openFAQ === index ? null : index)}
                className="w-full px-6 py-4 text-left bg-white hover:bg-gray-50 transition-colors flex justify-between items-center"
              >
                <span className="font-semibold text-gray-900 pr-4">
                  {faq.question}
                </span>
                <span className={`text-blaze-600 transition-transform ${
                  openFAQ === index ? 'rotate-45' : ''
                }`}>
                  +
                </span>
              </button>
              {openFAQ === index && (
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                  <p className="text-gray-700 leading-relaxed">{faq.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Still Have Questions CTA */}
        <div className="text-center mt-16">
          <div className="bg-blaze-50 p-8 rounded-xl max-w-2xl mx-auto">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">
              Still Have Questions?
            </h3>
            <p className="text-gray-600 mb-6">
              Join our community on GitHub or check out the comprehensive documentation 
              with step-by-step guides and troubleshooting.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="https://github.com/sderosiaux/blaze-gallery/discussions"
                className="bg-blaze-600 hover:bg-blaze-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                Ask on GitHub
              </a>
              <a
                href="https://github.com/sderosiaux/blaze-gallery/blob/main/README.md"
                className="text-blaze-600 hover:text-blaze-700 px-6 py-3 font-semibold transition-colors"
              >
                Read Documentation
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}