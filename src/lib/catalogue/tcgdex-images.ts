export function tcgdexJapaneseImageUrlFromProviderIds(
  providerIds: unknown,
  size: "high" | "low" = "high",
) {
  if (!providerIds || typeof providerIds !== "object" || Array.isArray(providerIds)) {
    return undefined;
  }

  const providerId = (providerIds as Record<string, unknown>).tcgdex;

  if (typeof providerId !== "string") {
    return undefined;
  }

  const separatorIndex = providerId.lastIndexOf("-");

  if (separatorIndex <= 0 || separatorIndex >= providerId.length - 1) {
    return undefined;
  }

  const setCode = providerId.slice(0, separatorIndex);
  const localId = providerId.slice(separatorIndex + 1);
  const seriesCode = setCode.match(/^[a-z]+/i)?.[0]?.toUpperCase();

  if (!seriesCode || !localId) {
    return undefined;
  }

  return `https://assets.tcgdex.net/ja/${encodeURIComponent(seriesCode)}/${encodeURIComponent(setCode)}/${encodeURIComponent(localId)}/${size}.png`;
}
