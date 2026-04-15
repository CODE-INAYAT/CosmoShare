import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import Script from "next/script";
import { InspectRestriction } from "@/components/InspectRestriction";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CosmoShare — Instant P2P File Sharing for Lab Environments",
    template: "%s | CosmoShare",
  },
  description:
    "Share files instantly with peers in your lab room using WebRTC peer-to-peer transfers. No uploads, no size limits — just fast, encrypted, cross-platform sharing and smart print queues.",
  metadataBase: new URL("https://cosmoshare.pages.dev"),
  keywords: [
    "CosmoShare",
    "WebRTC",
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
    title: "CosmoShare — Instant P2P File Sharing for Lab Environments",
    description:
      "Share files instantly with peers in your lab room using WebRTC. No uploads, no size limits, end-to-end encrypted.",
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
    title: "CosmoShare — Instant P2P File Sharing for Lab Environments",
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
        <meta name="theme-color" content="#10b981" />
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
        <Script src="https://cdn.socket.io/4.7.2/socket.io.min.js" strategy="beforeInteractive" />
      </body>
    </html>
  );
}
