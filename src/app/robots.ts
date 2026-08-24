import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://mintbinder.co.uk";

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/legal/"],
      disallow: ["/api/"],
    },
    sitemap: new URL("/sitemap.xml", appUrl).toString(),
    host: new URL(appUrl).origin,
  };
}
