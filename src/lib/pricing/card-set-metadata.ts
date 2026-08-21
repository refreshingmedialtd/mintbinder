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
