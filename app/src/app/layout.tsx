import type { Metadata } from "next";
import "./globals.css";
import Header from "./components/Header";
import Footer from "./components/Footer";
import { AIAssistantProvider, AIAssistantBubble } from "./components/AIAssistant";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://theeichmanntrial.org";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "The Eichmann Trial | Voices of Testimony",
    template: "%s | The Eichmann Trial",
  },
  description: "In 1961, the Holocaust was placed at the center of a courtroom. Not through documents. Through voices. Explore the testimonies that transformed how we remember.",
  keywords: ["Eichmann Trial", "Holocaust", "Testimony", "Witnesses", "Jerusalem 1961", "Holocaust Remembrance", "Adolf Eichmann", "Holocaust Education", "Trial Archives"],
  authors: [{ name: "The Eichmann Trial Archive" }],
  creator: "Alon Carmel",
  openGraph: {
    title: "The Eichmann Trial | Voices of Testimony",
    description: "The trial that transformed how the Holocaust is remembered. Explore the voices of 110 witnesses.",
    type: "website",
    locale: "en_US",
    siteName: "The Eichmann Trial",
    images: [
      {
        url: `${siteUrl}/images/socialcover.png`,
        width: 1200,
        height: 630,
        alt: "The Eichmann Trial - In 1961, the Holocaust was placed at the center of a courtroom",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "The Eichmann Trial | Voices of Testimony",
    description: "The trial that transformed how the Holocaust is remembered.",
    images: [`${siteUrl}/images/socialcover.png`],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased bg-stone-950 text-stone-100">
        <AIAssistantProvider>
          <Header />
          {children}
          <Footer />
          <AIAssistantBubble />
        </AIAssistantProvider>
      </body>
    </html>
  );
}
