import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import Script from "next/script";
import { InspectRestriction } from "@/components/InspectRestriction";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ShareBytes - P2P File Sharing for Labs",
  description: "Peer-to-peer file sharing system for lab environments. Share files instantly with friends and submit print requests to lab admin.",
  keywords: ["ShareBytes", "WebRTC", "P2P", "File Sharing", "Lab", "Education", "Print", "Next.js"],
  authors: [{ name: "ShareBytes Team" }],
  icons: {
    icon: ".\\favicon.ico",
  },
  openGraph: {
    title: "ShareBytes - P2P File Sharing",
    description: "Peer-to-peer file sharing system for lab environments",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ShareBytes - P2P File Sharing",
    description: "Peer-to-peer file sharing system for lab environments",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={plusJakartaSans.className}>
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
        <Script src="https://cdn.socket.io/4.7.2/socket.io.min.js" strategy="beforeInteractive" />
      </body>
    </html>
  );
}
