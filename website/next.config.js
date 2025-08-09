/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  distDir: 'out',
  ...(process.env.NODE_ENV === 'production' && {
    basePath: '/blaze-gallery',
    assetPrefix: '/blaze-gallery/',
  }),
  images: {
    unoptimized: true
  }
}

module.exports = nextConfig