import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { InspectRestriction } from "@/components/InspectRestriction";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CosmoShare | Share Smarter. Share Anything, Anytime",
    template: "%s | CosmoShare",
  },
  description:
    "Share files instantly with peers in your lab room using direct browser-to-browser peer-to-peer transfers. No uploads, no size limits — just fast, encrypted, cross-platform sharing and smart print queues.",
  metadataBase: new URL("https://cosmoshare.pages.dev"),
  keywords: [
    "CosmoShare",
    "Direct Sharing",
    "P2P",
    "File Sharing",
    "Lab",
    "Education",
    "Print",
    "Next.js",
  ],
  authors: [{ name: "CosmoShare Team" }],
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    url: "https://cosmoshare.pages.dev",
    siteName: "CosmoShare",
    title: "CosmoShare | Share Smarter. Share Anything, Anytime",
    description:
      "Share files instantly with peers in your lab room using direct peer-to-peer sharing. No uploads, no size limits, end-to-end encrypted.",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "CosmoShare — P2P File Sharing for Labs",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CosmoShare | Share Smarter. Share Anything, Anytime",
    description:
      "Lightning-fast peer-to-peer file sharing for lab rooms. No uploads, no size limits, cross-platform.",
    images: ["/og-image.jpg"],
  },
  robots: { index: true, follow: true },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CosmoShare",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={plusJakartaSans.className}>
      <head>
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#09090b" />
        {/* iOS Splash Screens */}
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-2048-2732.png" media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1668-2388.png" media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1536-2048.png" media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1170-2532.png" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1125-2436.png" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              "name": "CosmoShare",
              "url": "https://cosmoshare.pages.dev"
            })
          }}
        />
      </head>
      <body className={`${plusJakartaSans.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange={false}
        >
          {children}
        </ThemeProvider>
        <Toaster />
        <SonnerToaster />
        <InspectRestriction />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
