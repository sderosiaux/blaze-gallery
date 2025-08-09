'use client'

import { useState } from 'react'

export default function QuickStart() {
  const [copiedStep, setCopiedStep] = useState<number | null>(null)

  const copyToClipboard = (text: string, stepIndex: number) => {
    navigator.clipboard.writeText(text)
    setCopiedStep(stepIndex)
    setTimeout(() => setCopiedStep(null), 2000)
  }

  const steps = [
    {
      title: 'Create Backblaze B2 Account',
      time: '2 min',
      icon: '☁️',
      description: 'Sign up for Backblaze B2 and create a bucket for your photos',
      action: {
        type: 'link',
        text: 'Sign Up Free →',
        url: 'https://backblaze.com/b2'
      }
    },
    {
      title: 'Get Blaze Gallery',
      time: '1 min',
      icon: '📥',
      description: 'Clone the repository and copy the environment template',
      action: {
        type: 'copy',
        text: 'git clone https://github.com/sderosiaux/blaze-gallery.git\ncd blaze-gallery\ncp .env.template .env'
      }
    },
    {
      title: 'Add Your B2 Credentials',
      time: '1 min',
      icon: '🔑',
      description: 'Edit .env file with your B2 bucket name, endpoint, and API keys',
      action: {
        type: 'copy',
        text: 'BACKBLAZE_ENDPOINT=https://s3.us-west-004.backblazeb2.com\nBACKBLAZE_BUCKET=your-photo-bucket\nBACKBLAZE_ACCESS_KEY=your_key_id\nBACKBLAZE_SECRET_KEY=your_secret'
      }
    },
    {
      title: 'Launch Blaze Gallery',
      time: '30 sec',
      icon: '🚀',
      description: 'Start the Docker container and your gallery is ready!',
      action: {
        type: 'copy',
        text: 'docker-compose up -d'
      }
    },
    {
      title: 'Access & Sync',
      time: '30 sec',
      icon: '🎉',
      description: 'Visit localhost:3000 and your photos will sync automatically',
      action: {
        type: 'link',
        text: 'Open Gallery →',
        url: 'http://localhost:3000'
      }
    }
  ]

  return (
    <section id="quick-start" className="py-20 bg-gradient-to-br from-blaze-50 to-orange-100">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            5-Minute Setup. Seriously.
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8">
            <span className="font-semibold text-green-600">Blaze Gallery is 100% free and open source</span> - get your own lightning-fast photo gallery running in the time it takes to make coffee.
          </p>
          
          {/* Prerequisites */}
          <div className="bg-white/80 p-6 rounded-lg max-w-2xl mx-auto mb-8">
            <h3 className="font-semibold text-gray-900 mb-3">Prerequisites (probably already have these):</h3>
            <div className="flex flex-wrap justify-center gap-4 text-sm">
              <span className="bg-gray-100 px-3 py-1 rounded-full">🐳 Docker & Docker Compose</span>
              <span className="bg-gray-100 px-3 py-1 rounded-full">💻 Terminal Access</span>
              <span className="bg-gray-100 px-3 py-1 rounded-full">🌐 Internet Connection</span>
            </div>
          </div>
        </div>

        {/* Step-by-step Guide */}
        <div className="max-w-4xl mx-auto">
          {steps.map((step, index) => (
            <div 
              key={index}
              className="bg-white rounded-xl shadow-sm p-6 mb-6 flex items-center space-x-6"
            >
              {/* Step Number */}
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-blaze-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                  {index + 1}
                </div>
              </div>

              {/* Step Icon */}
              <div className="text-3xl">{step.icon}</div>

              {/* Step Content */}
              <div className="flex-grow">
                <div className="flex items-center space-x-3 mb-2">
                  <h3 className="text-xl font-bold text-gray-900">{step.title}</h3>
                  <span className="bg-blaze-100 text-blaze-700 px-2 py-1 rounded-full text-sm font-medium">
                    {step.time}
                  </span>
                </div>
                <p className="text-gray-600">{step.description}</p>
              </div>

              {/* Action Button */}
              <div className="flex-shrink-0">
                {step.action.type === 'link' ? (
                  <a
                    href={step.action.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-blaze-600 hover:bg-blaze-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                  >
                    {step.action.text}
                  </a>
                ) : (
                  <button
                    onClick={() => copyToClipboard(step.action.text!, index)}
                    className={`px-4 py-2 rounded-lg font-medium transition-all ${
                      copiedStep === index 
                        ? 'bg-green-600 text-white' 
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                  >
                    {copiedStep === index ? '✓ Copied!' : '📋 Copy'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  )
}