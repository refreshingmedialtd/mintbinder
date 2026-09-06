export type SealedImageQuarantine = {
  checkedAt: string;
  reason: "permanent_http_status";
  source: "sealed_image_reachability_probe";
  status: 400 | 403 | 404 | 410;
  url: string;
};

export function upgradedTcgcsvSealedImageUrl(value: unknown): string | undefined;
export function isPermanentSealedImageFailureStatus(value: unknown): value is 400 | 403 | 404 | 410;
export function sealedImageQuarantine(metadata: unknown): SealedImageQuarantine | undefined;
export function sealedImageUrlIsQuarantined(metadata: unknown, value: unknown): boolean;
export function importedTcgcsvSealedImageState(
  metadata: unknown,
  value: unknown,
  existingImageUrl?: unknown,
): {
  imageUrl: string | null | undefined;
  metadata: Record<string, unknown>;
};
export function sealedImageMetadataWithQuarantine(options: {
  checkedAt: Date | string;
  metadata: unknown;
  status: unknown;
  url: unknown;
}): Record<string, unknown> & { imageQuarantine: SealedImageQuarantine };
