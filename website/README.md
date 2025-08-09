# Blaze Gallery Website

Marketing website for Blaze Gallery - a self-hosted photo gallery that connects to your Backblaze B2 storage.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Export static files
npm run export
```

## 🌟 Features

- **Hero Section** - Compelling introduction with animated mockups
- **Cost Comparison** - Interactive calculator showing savings vs Google Photos/iCloud  
- **Architecture Diagram** - Visual explanation of how Blaze Gallery works
- **Interactive Demos** - Live previews of key features (folder browser, B2 audit, sharing, photo discovery)
- **Features Grid** - Comprehensive feature overview
- **Quick Start Guide** - 5-minute setup instructions with copy-paste commands
- **FAQ Section** - Categorized answers to common questions
- **Sticky GitHub Star** - Persistent call-to-action for GitHub engagement

## 🎨 Design

- **Tailwind CSS** for styling
- **Blaze Orange** color scheme matching the brand
- **Mobile-first responsive** design
- **Smooth animations** and transitions
- **Professional typography** with Inter font
- **Accessible** with proper ARIA labels and semantic HTML

## 🚢 Deployment

### GitHub Pages (Automatic)

The site deploys automatically to GitHub Pages when you push to `main` branch.

1. Enable GitHub Pages in your repository settings
2. Set source to "GitHub Actions" 
3. Push to `main` branch
4. Site will be available at `https://yourusername.github.io/blaze-gallery/`

### Manual Deployment

```bash
# Build and export static files
npm run build

# Deploy the 'out' folder to your hosting provider
# Files are in ./out/
```

## 🔧 Customization

### Update GitHub URLs

Search and replace `your-username/blaze-gallery` with your actual GitHub repository.

### Modify Content

- **Hero messaging**: Edit `src/components/HeroSection.tsx`
- **Pricing**: Update `src/components/CostComparison.tsx`  
- **Features**: Modify `src/components/FeaturesGrid.tsx`
- **FAQ**: Add questions in `src/components/FAQ.tsx`
- **Commands**: Update setup steps in `src/components/QuickStart.tsx`

### Styling

The design uses a custom Tailwind theme with "blaze" colors. Modify `tailwind.config.ts` to change the color scheme.

## 📱 Performance

- **Static export** - No server needed, fast loading
- **Optimized images** - Responsive and properly sized
- **Minimal JavaScript** - Only interactive components use client-side JS
- **Progressive enhancement** - Works with JavaScript disabled

## 🎯 Conversion Optimization

- **Clear value proposition** in hero
- **Social proof** with GitHub stars
- **Risk reduction** with open source transparency  
- **Multiple CTAs** throughout the page
- **FAQ addresses objections** before they arise
- **Quick setup** removes friction

## 🔍 SEO

- **Meta tags** for social sharing
- **Structured data** for rich snippets
- **Semantic HTML** for screen readers
- **Fast loading** for Core Web Vitals
- **Mobile optimization** for mobile-first indexing

Built with ❤️ for the Blaze Gallery community.