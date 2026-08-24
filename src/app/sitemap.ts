import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://mintbinder.co.uk";
  const pages = ["/", "/legal/privacy", "/legal/terms", "/legal/non-affiliation"];

  return pages.map((path, index) => ({
    url: new URL(path, appUrl).toString(),
    changeFrequency: index === 0 ? "weekly" : "yearly",
    priority: index === 0 ? 1 : 0.3,
  }));
}
