const optimizedCatalogueImageHosts = new Set([
  "assets.tcgdex.net",
  "images.pokemontcg.io",
  "tcgplayer-cdn.tcgplayer.com",
]);

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
