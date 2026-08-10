import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CosmoShare — Choose Your Sharing Mode",
  description:
    "Choose between OneShare for quick file sharing or Lab Share for room-based peer-to-peer transfers.",
  robots: { index: false, follow: false },
};

export default function PWALayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
