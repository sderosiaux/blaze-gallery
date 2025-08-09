import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Blaze Gallery - Your Photos, Your Cloud, Your Control',
  description: 'Self-hosted photo gallery that connects to your Backblaze B2 storage. View, organize, and share your photos while maintaining complete control over your data.',
  keywords: 'photo gallery, self-hosted, Backblaze B2, private photos, photo management, Docker',
  authors: [{ name: 'Blaze Gallery Team' }],
  creator: 'Blaze Gallery',
  openGraph: {
    title: 'Blaze Gallery - Your Photos, Your Cloud, Your Control',
    description: 'Self-hosted photo gallery that connects to your Backblaze B2 storage. Complete control over your photos.',
    type: 'website',
    locale: 'en_US',
    siteName: 'Blaze Gallery',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Blaze Gallery - Your Photos, Your Cloud, Your Control',
    description: 'Self-hosted photo gallery that connects to your Backblaze B2 storage.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={inter.className}>{children}</body>
    </html>
  )
}