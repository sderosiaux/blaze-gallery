import type { Metadata, Viewport } from 'next'
import { Hanken_Grotesk, JetBrains_Mono } from 'next/font/google'
import { asset } from '@/lib/asset'
import './globals.css'

const sans = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

const title = 'Blaze Gallery: the photos in your bucket, back in front of you'
const description =
  'A private, self-hosted gallery for the photos you already keep on Backblaze B2, S3 or R2. Your folders become albums. Nothing to import.'

export const metadata: Metadata = {
  metadataBase: new URL('https://sderosiaux.github.io'),
  title,
  description,
  icons: { icon: asset('favicon.svg') },
  openGraph: {
    title,
    description,
    type: 'website',
    siteName: 'Blaze Gallery',
    images: [{ url: asset('og.jpg'), width: 1200, height: 630, alt: 'A Blaze album of Christmas photos' }],
  },
  twitter: { card: 'summary_large_image', title, description, images: [asset('og.jpg')] },
}

export const viewport: Viewport = { themeColor: '#FFFFFF', colorScheme: 'light' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  )
}
