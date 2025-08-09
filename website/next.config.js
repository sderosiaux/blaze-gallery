/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  distDir: 'out',
  basePath: '/blaze-gallery',
  assetPrefix: '/blaze-gallery/',
  images: {
    unoptimized: true
  }
}

module.exports = nextConfig