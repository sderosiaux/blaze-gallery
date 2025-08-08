import type { Metadata, Viewport } from "next";
import "./globals.css";
import StartupManager from "@/components/StartupManager";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  ),
  title: "Blaze Gallery",
  description:
    "Lightning-fast photo gallery for your Backblaze B2 cloud storage",
  keywords: [
    "photo gallery",
    "backblaze b2",
    "self-hosted",
    "cloud storage",
    "photos",
  ],
  authors: [{ name: "Blaze Gallery Team" }],
  creator: "Blaze Gallery",
  publisher: "Blaze Gallery",
  robots: "index, follow",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.svg", sizes: "32x32", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/apple-touch-icon.svg", sizes: "180x180", type: "image/svg+xml" },
    ],
    other: [
      {
        rel: "icon",
        url: "/icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
      },
    ],
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Blaze Gallery",
  },
  openGraph: {
    type: "website",
    siteName: "Blaze Gallery",
    title: "Blaze Gallery - Your Backblaze Photos, Beautifully Browsable",
    description:
      "Lightning-fast photo gallery for your Backblaze B2 cloud storage",
    images: [
      {
        url: "/icon.svg",
        width: 512,
        height: 512,
        alt: "Blaze Gallery Logo",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Blaze Gallery",
    description:
      "Lightning-fast photo gallery for your Backblaze B2 cloud storage",
    images: ["/icon.svg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FF6B35",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        <StartupManager />
        {children}
      </body>
    </html>
  );
}
