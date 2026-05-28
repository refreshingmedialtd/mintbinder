import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PokeStop",
  description: "Pokemon card and sealed product collection tracker.",
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

