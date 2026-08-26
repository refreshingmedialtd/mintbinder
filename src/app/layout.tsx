import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://mintbinder.co.uk"),
  title: {
    default: "Mint Binder — Pokémon collection and sealed-product tracker",
    template: "%s | Mint Binder",
  },
  description:
    "Track Pokémon cards and sealed products, monitor market values, organise binders and build complete sets.",
  applicationName: "Mint Binder",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Mint Binder",
  },
  category: "collectibles",
  creator: "Mint Binder",
  icons: {
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
  },
  keywords: [
    "Pokémon card collection tracker",
    "sealed Pokémon products",
    "trading card binder",
    "Pokémon price history",
    "Pokémon set tracker",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: "/",
    siteName: "Mint Binder",
    title: "Mint Binder — your collection, properly organised",
    description:
      "Track cards and sealed products, organise binders and follow evidence-backed market values.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Mint Binder — Pokémon collection tracker",
    description:
      "Track cards and sealed products, organise binders and follow evidence-backed market values.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f2e8" },
    { media: "(prefers-color-scheme: dark)", color: "#101923" },
  ],
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Mint Binder",
  applicationCategory: "LifestyleApplication",
  operatingSystem: "Web",
  description:
    "Track Pokémon cards and sealed products, organise binders and follow evidence-backed market values.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "https://mintbinder.co.uk",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegistration />
        <script
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
          type="application/ld+json"
        />
      </body>
    </html>
  );
}
