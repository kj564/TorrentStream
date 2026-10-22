import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TorrentStream - Stream & Download Torrents in Browser",
  description: "Browser-based torrent streaming and download client. Paste a magnet link or upload a .torrent file to stream videos, audio, and download any file directly.",
  keywords: ["torrent", "magnet", "stream", "webtorrent", "download", "bittorrent"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "TorrentStream",
    description: "Stream & download torrents directly in your browser",
    url: "https://chat.z.ai",
    siteName: "TorrentStream",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TorrentStream",
    description: "Stream & download torrents directly in your browser",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
