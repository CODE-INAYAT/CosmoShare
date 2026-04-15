import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OneShare — Quick File Sharing Without a Room",
  description:
    "Share files and links instantly without joining a lab room. Generate a 4-digit code or scan a QR code for peer-to-peer transfers with end-to-end encryption via CosmoShare OneShare.",
  openGraph: {
    title: "OneShare — Quick File Sharing Without a Room | CosmoShare",
    description:
      "Instant peer-to-peer file sharing with a 4-digit code or QR scan. No room needed, no uploads, no size limits.",
  },
};

export default function OneShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
