/**
 * Catalogue providers own the descriptive card-set fields, but scheduled jobs
 * keep their rotation cursor and retry state in CardSet.metadata. Provider
 * refreshes must therefore leave metadata untouched when the set already
 * exists.
 */
export function preserveCardSetMetadataOnUpdate<T extends { metadata?: unknown }>(data: T): Omit<T, "metadata"> {
  const update = { ...data };

  delete update.metadata;

  return update as Omit<T, "metadata">;
}

/**
 * Exact-set refreshes are allowed to update provider-owned catalogue facts,
 * but must retain scheduler cursors and other operational metadata.
 */
export function mergeCardSetMetadata(existing: unknown, incoming: unknown): Record<string, unknown> {
  return {
    ...metadataObject(existing),
    ...metadataObject(incoming),
  };
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
