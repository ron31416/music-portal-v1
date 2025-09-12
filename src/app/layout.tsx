// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Music Portal",
  description: "",
  icons: {
    icon: [
      { url: "/favicon.ico" }, // default, legacy
      { url: "/favicon.png", type: "image/png", sizes: "32x32" }, // modern sharp
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
