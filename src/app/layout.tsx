import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PlayerProvider } from "@/components/player/PlayerContext";
import { Header } from "@/components/layout/Header";
import { VideoDock } from "@/components/player/VideoDock";

export const metadata: Metadata = {
  title: "محسن تيوب",
  description: "فيديوهات نافعة: دروس، كورسات، واصنعها بنفسك",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#19171b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Noto+Sans+Arabic:wght@400;500;700&family=Cairo:wght@800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <PlayerProvider>
          <Header />
          <main id="app">{children}</main>
          <VideoDock />
        </PlayerProvider>
      </body>
    </html>
  );
}
