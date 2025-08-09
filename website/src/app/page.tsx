import HeroSection from '@/components/HeroSection'
import CostComparison from '@/components/CostComparison'
import ArchitectureDiagram from '@/components/ArchitectureDiagram'
import InteractiveDemo from '@/components/InteractiveDemo'
import FeaturesGrid from '@/components/FeaturesGrid'
import FAQ from '@/components/FAQ'
import StickyGitHubStar from '@/components/StickyGitHubStar'

export default function Home() {
  return (
    <main className="relative">
      <StickyGitHubStar />
      
      {/* Hero Section */}
      <HeroSection />
      
      {/* Cost Comparison */}
      <CostComparison />
      
      {/* Architecture */}
      <ArchitectureDiagram />
      
      {/* Interactive Demos */}
      <InteractiveDemo />
      
      {/* Features */}
      <FeaturesGrid />
      
      {/* FAQ */}
      <FAQ />
      
      {/* Footer */}
      <footer className="bg-gray-950 text-white py-16">
        <div className="container mx-auto px-6 text-center max-w-6xl">
          <div className="mb-12">
            <div className="flex items-center justify-center space-x-3 mb-6">
              <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-600 rounded-2xl flex items-center justify-center shadow-lg">
                <span className="text-white text-2xl">🔥</span>
              </div>
              <span className="text-3xl font-light">Blaze Gallery</span>
            </div>
            <p className="text-gray-400 max-w-lg mx-auto text-lg font-light leading-relaxed">
              Your photos, your cloud, your control. Self-hosted photo gallery for the modern age.
            </p>
          </div>
          
          <div className="flex flex-wrap justify-center gap-8 mb-12 text-lg">
            <a href="https://github.com/sderosiaux/blaze-gallery" className="text-gray-400 hover:text-white transition-colors font-medium">
              GitHub
            </a>
            <a href="https://github.com/sderosiaux/blaze-gallery/blob/main/README.md" className="text-gray-400 hover:text-white transition-colors font-medium">
              Documentation
            </a>
            <a href="https://github.com/sderosiaux/blaze-gallery/issues" className="text-gray-400 hover:text-white transition-colors font-medium">
              Support
            </a>
          </div>
          
          <div className="border-t border-gray-800 pt-8">
            <p className="text-gray-500 font-light">
              © 2025 Blaze Gallery. Open source software released under the MIT License.
            </p>
          </div>
        </div>
      </footer>
    </main>
  )
}