import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PlayerProvider } from "@/components/player/PlayerContext";
import { Header } from "@/components/layout/Header";
import { VideoDock } from "@/components/player/VideoDock";
import { SignInGate } from "@/components/modals/SignInGate";

const SITE = "https://mohsen-tube.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  // Both names in the title, so a search for "محسن تيوب" or "Mohsen Tube" finds the site first
  title: "محسن تيوب | Mohsen Tube",
  description:
    "محسن تيوب (Mohsen Tube): فيديوهات نافعة خالية من الشبهات والشهوات. دروس، كورسات، تعلّم مهارة، واصنعها بنفسك.",
  applicationName: "محسن تيوب",
  keywords: ["محسن تيوب", "Mohsen Tube", "mohsen tube", "محسن", "فيديوهات نافعة", "دروس", "كورسات"],
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "محسن تيوب | Mohsen Tube",
    title: "محسن تيوب | Mohsen Tube",
    description: "فيديوهات نافعة خالية من الشبهات والشهوات",
    url: SITE,
    locale: "ar_EG",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "محسن تيوب" }],
  },
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
        {/* Tells Google the site's name in Arabic and English (shown as the site name in results) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "محسن تيوب",
              alternateName: ["Mohsen Tube", "mohsen tube", "محسن تيوب"],
              url: SITE + "/",
              potentialAction: {
                "@type": "SearchAction",
                target: SITE + "/search?q={search_term_string}",
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
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
