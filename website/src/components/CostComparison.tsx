'use client'

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
          ? 'border-blaze-500 bg-blaze-50 shadow-lg shadow-blaze-200' 
          : 'border-blaze-200 hover:border-blaze-400'
      case 'blue':
        return 'border-blue-200 hover:border-blue-400'
      case 'gray':
        return 'border-gray-200 hover:border-gray-400'
      default:
        return 'border-gray-200'
    }
  }

  const getTrustBadge = (trustLevel: string, privacy: string) => {
    if (trustLevel === 'high' && privacy === 'full') {
      return (
        <div className="inline-flex items-center px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
          <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
          Complete Trust
        </div>
      )
    } else if (trustLevel === 'medium') {
      return (
        <div className="inline-flex items-center px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
          <span className="w-2 h-2 bg-yellow-500 rounded-full mr-2"></span>
          Limited Trust
        </div>
      )
    } else {
      return (
        <div className="inline-flex items-center px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium">
          <span className="w-2 h-2 bg-red-500 rounded-full mr-2"></span>
          Privacy Risk
        </div>
      )
    }
  }

  return (
    <section id="privacy" className="py-20 bg-white">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            Your Family Photos Deserve Better
          </h2>
          <p className="text-xl text-gray-600 max-w-4xl mx-auto mb-8">
            Your memories are precious and private. <span className="font-semibold text-green-600">Blaze Gallery is 100% free and open source</span> - 
            compare what happens to your family photos and who really controls them.
          </p>
          
          <div className="bg-gray-50 p-6 rounded-xl max-w-3xl mx-auto">
            <h3 className="font-bold text-gray-900 mb-2">The Real Question Isn't Price</h3>
            <p className="text-gray-600">
              It's: <em>"Do I trust this company with my most intimate family moments? 
              Do I know what they do with my photos? Can they lock me out tomorrow?"</em>
            </p>
          </div>
        </div>

        {/* Privacy Comparison Cards */}
        <div className="grid lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {photoServices.map((service, index) => {
            const isRecommended = service.color === 'blaze'
            
            return (
              <div 
                key={service.name}
                className={`relative p-8 rounded-xl border-2 transition-all duration-300 ${getColorClasses(service.color, isRecommended)}`}
              >
                {isRecommended && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <span className="bg-blaze-600 text-white px-6 py-2 rounded-full text-sm font-semibold">
                      Recommended
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
                    <a
                      href="https://github.com/sderosiaux/blaze-gallery"
                      className="w-full bg-blaze-600 hover:bg-blaze-700 text-white py-3 px-6 rounded-lg font-semibold text-center block transition-colors"
                    >
                      Get Blaze Gallery →
                    </a>
                  ) : (
                    <div className="text-center">
                      <div className="text-sm text-gray-500 italic">
                        "Convenient, but your family photos become their business data"
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
          <div className="bg-gradient-to-r from-blaze-50 to-orange-50 p-8 rounded-xl max-w-5xl mx-auto border border-blaze-200">
            <h3 className="text-3xl font-bold text-gray-900 mb-4">
              Your Memories. Your Server. Your Peace of Mind.
            </h3>
            <p className="text-xl text-gray-600 mb-6 leading-relaxed">
              Stop wondering what happens to your family photos behind closed doors. 
              With Blaze Gallery, you know exactly where they are, who can see them, and that they'll always be yours.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <a
                href="https://github.com/sderosiaux/blaze-gallery"
                className="bg-blaze-600 hover:bg-blaze-700 text-white px-8 py-4 rounded-lg font-semibold text-lg transition-colors"
              >
                Get Blaze Gallery →
              </a>
              <div className="flex items-center text-gray-600">
                <span className="mr-2">🔓</span>
                <span className="font-medium">100% Free & Open Source</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}