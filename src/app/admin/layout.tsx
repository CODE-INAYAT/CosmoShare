import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin Dashboard — Lab Print Queue Manager",
  description:
    "Manage your lab room's print queue, receive files from students via peer-to-peer WebRTC, and track real-time connection status from the CosmoShare admin dashboard.",
  openGraph: {
    title: "Admin Dashboard — Lab Print Queue Manager | CosmoShare",
    description:
      "Manage your lab room's print queue and receive files from students in real time with CosmoShare.",
  },
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
