/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pg']
  },
  images: {
    domains: [],
    unoptimized: true
  },
  async rewrites() {
    return [
      {
        source: '/api/photos/:id/thumbnail',
        destination: '/api/photos/:id/thumbnail'
      }
    ]
  }
}

module.exports = nextConfig