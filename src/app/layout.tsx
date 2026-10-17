import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import StartupManager from "@/components/StartupManager";
import { LayoutProvider } from "@/contexts/LayoutContext";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ToastProvider } from "@/components/ui/Toast";

const sans = Hanken_Grotesk({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  ),
  title: "Blaze Gallery",
  description:
    "Vos photos, depuis votre propre stockage.",
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
    statusBarStyle: "default",
    title: "Blaze Gallery",
  },
  openGraph: {
    type: "website",
    siteName: "Blaze Gallery",
    title: "Blaze Gallery",
    description:
      "Vos photos, depuis votre propre stockage.",
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
      "Vos photos, depuis votre propre stockage.",
    images: ["/icon.svg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FFFFFF",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={sans.variable}>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-dvh">
        <LayoutProvider>
          <AuthProvider>
            <ToastProvider>
              <StartupManager />
              {children}
            </ToastProvider>
          </AuthProvider>
        </LayoutProvider>
      </body>
    </html>
  );
}
