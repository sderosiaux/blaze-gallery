/** @type {import('next').NextConfig} */
// GitHub Pages serves the site under /blaze-gallery; locally it lives at /.
const basePath = process.env.NODE_ENV === 'production' ? '/blaze-gallery' : ''

const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
}

module.exports = nextConfig
