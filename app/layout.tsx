import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/*
 * The fonts are served from this repo, not from Google.
 *
 * next/font/google downloads them at BUILD time, so `npm run build` needed a
 * working connection to fonts.googleapis.com and failed outright without one -
 * on the plant machine, on a deploy behind a firewall, or on any day the
 * network is down. A foundry's ERP should build and run with the cable
 * unplugged, so the two woff2 files live in app/fonts and are read off disk.
 *
 * They are the same variable faces Google serves, latin subset. To update
 * them, download the woff2 the css2 API points at and drop it in place.
 */
const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
  // Used when the face has not painted yet, and if the file ever goes missing
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: "Molten Metal ERP",
  description:
    "Aluminium casting inventory, production and fettling management for Molten Metal Pvt Ltd",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
