import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import "@/lib/env";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "SocialOS",
  description: "AI-powered social media content platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable} h-full antialiased`}>
      {/* suppressHydrationWarning: browser extensions (e.g. crypto wallets) inject attributes into <body> */}
      <body className="min-h-full font-sans antialiased grid-bg" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
