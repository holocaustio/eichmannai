import type { Metadata } from "next";
import "./globals.css";
import Header from "./components/Header";
import { AIAssistantProvider, AIAssistantBubble } from "./components/AIAssistant";

export const metadata: Metadata = {
  title: "The Eichmann Trial | Voices of Testimony",
  description: "In 1961, the Holocaust was placed at the center of a courtroom. Not through documents. Through voices. Explore the testimonies that transformed how we remember.",
  keywords: ["Eichmann Trial", "Holocaust", "Testimony", "Witnesses", "Jerusalem 1961", "Holocaust Remembrance"],
  authors: [{ name: "The Eichmann Trial Archive" }],
  openGraph: {
    title: "The Eichmann Trial | Voices of Testimony",
    description: "The trial that transformed how the Holocaust is remembered. Explore the voices of 110 witnesses.",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Eichmann Trial | Voices of Testimony",
    description: "The trial that transformed how the Holocaust is remembered.",
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
          <AIAssistantBubble />
        </AIAssistantProvider>
      </body>
    </html>
  );
}
