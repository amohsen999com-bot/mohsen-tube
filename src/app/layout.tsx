import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PlayerProvider } from "@/components/player/PlayerContext";
import { Header } from "@/components/layout/Header";
import { VideoDock } from "@/components/player/VideoDock";
import { SignInGate } from "@/components/modals/SignInGate";

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
  // Use the whole screen, including beside the camera cutout: without this, phones with a punch-hole camera
  // letterbox fullscreen video away from the camera side, so one black bar ends up wider than the other.
  viewportFit: "cover",
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
          {/* Nothing inside can make the page wider than the screen (iPhone would zoom out and push it sideways) */}
          <div className="page-clip">
            <Header />
            <main id="app">{children}</main>
            <VideoDock />
          </div>
          <SignInGate />
        </PlayerProvider>
      </body>
    </html>
  );
}
