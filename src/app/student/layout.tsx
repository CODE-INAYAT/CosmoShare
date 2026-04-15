import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Student Dashboard — Share Files & Print in Your Lab Room",
  description:
    "Join your lab room to share files with peers, send documents to the admin print queue, and collaborate in real time using WebRTC peer-to-peer connections on CosmoShare.",
  openGraph: {
    title: "Student Dashboard — Share Files & Print | CosmoShare",
    description:
      "Join your lab room to share files, send print requests, and collaborate in real time via CosmoShare.",
  },
};

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
