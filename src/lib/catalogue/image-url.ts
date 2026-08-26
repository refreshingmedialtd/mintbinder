const optimizedCatalogueImageHosts = new Set([
  "images.pokemontcg.io",
  "images.scrydex.com",
  "tcgplayer-cdn.tcgplayer.com",
]);

/**
 * TCGdex assets deliberately bypass the server-side Next image optimiser. Its
 * CDN can take more than Next's fixed seven-second upstream timeout to begin a
 * response, even when the image is valid. Letting the browser request those
 * already-cacheable assets directly prevents a transient optimiser 504 from
 * turning a slow image into a permanent-looking placeholder.
 */

export function isOptimizableCatalogueImageUrl(value: string) {
  const source = value.trim();

  if (source.startsWith("/") && !source.startsWith("//")) {
    return true;
  }

  try {
    const url = new URL(source);
    return url.protocol === "https:" && optimizedCatalogueImageHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
