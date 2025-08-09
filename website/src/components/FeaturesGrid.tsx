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

  return (
    <section className="py-20 bg-gray-50">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            Everything You Need for Photo Management
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            <span className="font-semibold text-green-600">Blaze Gallery is 100% free and open source.</span> It combines the best of self-hosted control with Backblaze B2's affordable cloud storage. 
            Here's what makes it special:
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {features.map((feature, index) => (
            <div 
              key={index}
              className="bg-white p-6 rounded-xl shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="text-4xl mb-4">{feature.icon}</div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">{feature.title}</h3>
              <p className="text-gray-600 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="text-center mt-16">
          <div className="bg-white p-8 rounded-xl shadow-sm max-w-2xl mx-auto">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">
              Ready to Take Control of Your Photos?
            </h3>
            <p className="text-gray-600 mb-6">
              Join users who've taken control of their photo storage with transparent pricing and complete privacy.
            </p>
            <a
              href="https://github.com/sderosiaux/blaze-gallery"
              className="bg-blaze-600 hover:bg-blaze-700 text-white px-8 py-3 rounded-lg font-semibold inline-block transition-colors mr-4"
            >
              Get Blaze Gallery
            </a>
            <a
              href="https://github.com/sderosiaux/blaze-gallery"
              className="text-blaze-600 hover:text-blaze-700 font-semibold inline-block transition-colors"
            >
              View Source Code →
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}