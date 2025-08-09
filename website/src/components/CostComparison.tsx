'use client'

import { useState } from 'react'

interface StorageOption {
  name: string
  logo: string
  color: string
  pricePerTB: number
  features: string[]
  limitations: string[]
}

const storageOptions: StorageOption[] = [
  {
    name: 'Backblaze B2 + Blaze Gallery',
    logo: '🔥',
    color: 'blaze',
    pricePerTB: 6,
    features: [
      'Full control of your data',
      'Self-hosted - no vendor lock-in', 
      'Unlimited users and sharing',
      'Advanced folder organization',
      'Password-protected sharing',
      'No file count limits',
      'Direct B2 integration'
    ],
    limitations: [
      'Requires Docker setup (5 min)',
      'You manage updates'
    ]
  },
  {
    name: 'Google Photos',
    logo: '📷',
    color: 'blue',
    pricePerTB: 120,
    features: [
      'Automatic face recognition',
      'Google AI search',
      'Mobile app included',
      'Easy setup'
    ],
    limitations: [
      '20x more expensive',
      'Google scans your photos',
      'Limited sharing options',
      'Can lose access anytime',
      'No folder organization',
      'Compression may reduce quality'
    ]
  },
  {
    name: 'iCloud Photos',
    logo: '☁️',
    color: 'gray',
    pricePerTB: 120,
    features: [
      'Seamless Apple integration',
      'Device synchronization',
      'Family sharing'
    ],
    limitations: [
      '20x more expensive',
      'Apple ecosystem only',
      'Limited sharing with non-Apple users',
      'No advanced organization',
      'Can\'t access raw files easily',
      'Storage limits force upgrades'
    ]
  }
]

export default function CostComparison() {
  const [selectedStorage, setSelectedStorage] = useState(5) // 5TB default

  const calculateYearlyCost = (pricePerTB: number, storage: number) => {
    return Math.round(pricePerTB * storage * 12)
  }

  const getColorClasses = (color: string, isSelected = false) => {
    switch (color) {
      case 'blaze':
        return isSelected 
          ? 'border-blaze-500 bg-blaze-50 shadow-lg shadow-blaze-200' 
          : 'border-blaze-200 hover:border-blaze-400'
      case 'blue':
        return isSelected 
          ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-200' 
          : 'border-blue-200 hover:border-blue-400'
      case 'gray':
        return isSelected 
          ? 'border-gray-500 bg-gray-50 shadow-lg shadow-gray-200' 
          : 'border-gray-200 hover:border-gray-400'
      default:
        return 'border-gray-200'
    }
  }

  return (
    <section id="pricing" className="py-20 bg-white">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            Stop Paying 20x More for Photo Storage
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8">
            Compare the real cost of storing your photos. Blaze Gallery + Backblaze B2 
            delivers enterprise-grade storage at a fraction of the cost.
          </p>
          
          {/* Storage Size Selector */}
          <div className="inline-flex bg-gray-100 p-1 rounded-lg">
            {[1, 2, 5, 10, 20].map((size) => (
              <button
                key={size}
                onClick={() => setSelectedStorage(size)}
                className={`px-4 py-2 rounded-md font-medium transition-all ${
                  selectedStorage === size 
                    ? 'bg-white text-blaze-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {size}TB
              </button>
            ))}
          </div>
        </div>

        {/* Comparison Cards */}
        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {storageOptions.map((option, index) => {
            const yearlyCost = calculateYearlyCost(option.pricePerTB, selectedStorage)
            const isRecommended = option.color === 'blaze'
            
            return (
              <div 
                key={option.name}
                className={`relative p-8 rounded-xl border-2 transition-all duration-300 ${getColorClasses(option.color, isRecommended)}`}
              >
                {isRecommended && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <span className="bg-blaze-600 text-white px-6 py-2 rounded-full text-sm font-semibold">
                      Recommended
                    </span>
                  </div>
                )}
                
                {/* Header */}
                <div className="text-center mb-8">
                  <div className="text-4xl mb-4">{option.logo}</div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">{option.name}</h3>
                  <div className="text-4xl font-bold text-gray-900 mb-2">
                    ${yearlyCost}
                    <span className="text-base font-normal text-gray-500">/year</span>
                  </div>
                  <p className="text-gray-600">
                    ${option.pricePerTB}/TB/month • {selectedStorage}TB storage
                  </p>
                </div>

                {/* Features */}
                <div className="mb-6">
                  <h4 className="font-semibold text-gray-900 mb-3">What you get:</h4>
                  <ul className="space-y-2">
                    {option.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start text-sm text-gray-700">
                        <span className="text-green-500 mr-2 mt-0.5">✓</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Limitations */}
                {option.limitations.length > 0 && (
                  <div className="mb-6">
                    <h4 className="font-semibold text-gray-900 mb-3">Consider:</h4>
                    <ul className="space-y-2">
                      {option.limitations.map((limitation, idx) => (
                        <li key={idx} className="flex items-start text-sm text-gray-600">
                          <span className="text-yellow-500 mr-2 mt-0.5">⚠</span>
                          {limitation}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* CTA */}
                <div className="pt-4 border-t border-gray-200">
                  {isRecommended ? (
                    <a
                      href="#quick-start"
                      className="w-full bg-blaze-600 hover:bg-blaze-700 text-white py-3 px-6 rounded-lg font-semibold text-center block transition-colors"
                    >
                      Get Started Free
                    </a>
                  ) : (
                    <div className="text-center">
                      <div className="text-sm text-gray-500">
                        vs Blaze Gallery: <span className="font-bold text-red-600">
                          {Math.round(yearlyCost / calculateYearlyCost(storageOptions[0].pricePerTB, selectedStorage))}x more expensive
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Bottom CTA */}
        <div className="text-center mt-16">
          <div className="bg-blaze-50 p-8 rounded-xl max-w-4xl mx-auto">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">
              Ready to save ${calculateYearlyCost(120, selectedStorage) - calculateYearlyCost(6, selectedStorage)} per year?
            </h3>
            <p className="text-gray-600 mb-6">
              Join thousands of users who've taken control of their photo storage costs.
            </p>
            <a
              href="#quick-start"
              className="bg-blaze-600 hover:bg-blaze-700 text-white px-8 py-3 rounded-lg font-semibold inline-block transition-colors"
            >
              Start Your Free Setup →
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}