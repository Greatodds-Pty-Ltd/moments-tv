import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Moments TV", robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#061F3F", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body>{children}</body>
    </html>
  );
}
