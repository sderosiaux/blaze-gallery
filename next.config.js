/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Docker image builds with BUILD_STANDALONE=1 and runs
  // .next/standalone/server.js, a server carrying only the node_modules it
  // uses. `next start` does not support that output, so it stays opt-in.
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  experimental: {
    serverComponentsExternalPackages: ['pg'],
    // The scene tags' vocabulary, read at run time (src/lib/filterResolver.ts)
    outputFileTracingIncludes: { '/api/**/*': ['./db/tags.json'] }
  },
  images: {
    domains: [],
    unoptimized: true
  },
  // A private library: no search engine, no framing, no link leaking where
  // it came from (share links carry their token in the path).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          }
        ]
      }
    ]
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
