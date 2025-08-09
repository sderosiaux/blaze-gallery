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
      <footer className="bg-gray-900 text-white py-12">
        <div className="container mx-auto px-6 text-center">
          <div className="mb-8">
            <div className="flex items-center justify-center space-x-2 mb-4">
              <div className="w-8 h-8 bg-gradient-to-br from-blaze-400 to-blaze-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">🔥</span>
              </div>
              <span className="text-xl font-bold">Blaze Gallery</span>
            </div>
            <p className="text-gray-400 max-w-md mx-auto">
              Your photos, your cloud, your control. Self-hosted photo gallery for the modern age.
            </p>
          </div>
          
          <div className="flex flex-wrap justify-center gap-6 mb-8">
            <a href="https://github.com/sderosiaux/blaze-gallery" className="text-gray-400 hover:text-white transition-colors">
              GitHub
            </a>
            <a href="https://github.com/sderosiaux/blaze-gallery/blob/main/README.md" className="text-gray-400 hover:text-white transition-colors">
              Documentation
            </a>
            <a href="https://github.com/sderosiaux/blaze-gallery/issues" className="text-gray-400 hover:text-white transition-colors">
              Support
            </a>
          </div>
          
          <div className="border-t border-gray-800 pt-8">
            <p className="text-gray-400 text-sm">
              © 2025 Blaze Gallery. Open source software released under the MIT License.
            </p>
          </div>
        </div>
      </footer>
    </main>
  )
}