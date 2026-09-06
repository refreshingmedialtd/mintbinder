const permanentImageFailureStatuses = new Set([400, 403, 404, 410]);

export function upgradedTcgcsvSealedImageUrl(value) {
  const imageUrl = typeof value === "string" ? value.trim() : "";

  return imageUrl ? imageUrl.replace("_200w.", "_in_1000x1000.") : undefined;
}

export function isPermanentSealedImageFailureStatus(value) {
  return permanentImageFailureStatuses.has(Number(value));
}

export function sealedImageQuarantine(metadata) {
  const record = objectValue(objectValue(metadata)?.imageQuarantine);
  const status = Number(record?.status);
  const url = upgradedTcgcsvSealedImageUrl(record?.url);
  const checkedAt = typeof record?.checkedAt === "string" ? new Date(record.checkedAt) : undefined;

  if (
    !record ||
    !url ||
    !isHttpsUrl(url) ||
    !isPermanentSealedImageFailureStatus(status) ||
    record.reason !== "permanent_http_status" ||
    record.source !== "sealed_image_reachability_probe" ||
    !checkedAt ||
    Number.isNaN(checkedAt.getTime())
  ) {
    return undefined;
  }

  return {
    checkedAt: record.checkedAt,
    reason: "permanent_http_status",
    source: "sealed_image_reachability_probe",
    status,
    url,
  };
}

export function sealedImageUrlIsQuarantined(metadata, value) {
  const candidateUrl = upgradedTcgcsvSealedImageUrl(value);
  const quarantine = sealedImageQuarantine(metadata);

  return Boolean(candidateUrl && quarantine && quarantine.url === candidateUrl);
}

export function importedTcgcsvSealedImageState(metadata, value, existingImageUrl) {
  const imageUrl = upgradedTcgcsvSealedImageUrl(value);
  const existingMetadata = objectValue(metadata) ?? {};
  const currentImageUrl = typeof existingImageUrl === "string" ? existingImageUrl.trim() : "";

  if (!imageUrl) {
    return {
      imageUrl: undefined,
      metadata: existingMetadata,
    };
  }

  if (sealedImageUrlIsQuarantined(existingMetadata, imageUrl)) {
    const currentCanonicalUrl = upgradedTcgcsvSealedImageUrl(currentImageUrl);

    return {
      imageUrl: currentImageUrl && currentCanonicalUrl !== imageUrl ? currentImageUrl : null,
      metadata: existingMetadata,
    };
  }

  return {
    imageUrl,
    metadata: clearStaleSealedImageQuarantine(existingMetadata, imageUrl) ?? existingMetadata,
  };
}

export function sealedImageMetadataWithQuarantine({ checkedAt, metadata, status, url }) {
  const canonicalUrl = upgradedTcgcsvSealedImageUrl(url);
  const checkedDate = checkedAt instanceof Date ? checkedAt : new Date(checkedAt);

  if (
    !canonicalUrl ||
    !isHttpsUrl(canonicalUrl) ||
    !isPermanentSealedImageFailureStatus(status) ||
    Number.isNaN(checkedDate.getTime())
  ) {
    throw new Error("A sealed image quarantine requires a valid URL, permanent HTTP status, and checked time.");
  }

  return {
    ...(objectValue(metadata) ?? {}),
    imageQuarantine: {
      checkedAt: checkedDate.toISOString(),
      reason: "permanent_http_status",
      source: "sealed_image_reachability_probe",
      status: Number(status),
      url: canonicalUrl,
    },
  };
}

function clearStaleSealedImageQuarantine(metadata, candidateUrl) {
  const source = objectValue(metadata);
  const quarantine = sealedImageQuarantine(source);

  if (!source || !quarantine || quarantine.url === candidateUrl) {
    return undefined;
  }

  const nextMetadata = { ...source };

  delete nextMetadata.imageQuarantine;

  return nextMetadata;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
