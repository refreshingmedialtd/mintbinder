export const LEGACY_DEFAULT_BINDER_MARKER = "[Legacy source: default]";
export const MANAGED_DEFAULT_BINDER_MARKER = "[Managed binder: full-collection]";

type BinderAssignmentState = {
  id: string;
  pages: Array<{
    slots: Array<{
      collectionItemId?: string | null;
      copyIndex?: number | null;
    }>;
  }>;
};

type OwnedCardLotState = {
  id: string;
  quantity: number;
};

export function consumeLegacyDefaultBinderMarker(description: string | null | undefined) {
  const normalized = description?.trim() ?? "";

  if (!normalized.endsWith(LEGACY_DEFAULT_BINDER_MARKER)) {
    return { consumed: false, description: description ?? null };
  }

  return {
    consumed: true,
    description: withManagedDefaultBinderMarker(
      normalized.slice(0, -LEGACY_DEFAULT_BINDER_MARKER.length).trim() || null,
    ),
  };
}

export function consumeLegacyCustomBinderMarker(description: string | null | undefined) {
  const normalized = description?.trim() ?? "";
  const match = normalized.match(/\[Legacy source: ([^\]]+)]$/);

  if (!match || match[1] === "default") {
    return { consumed: false, description: description ?? null };
  }

  const pendingMarker = match[0];
  const visible = normalized.slice(0, -pendingMarker.length).trim();
  return {
    consumed: true,
    description: `${visible ? `${visible} ` : ""}[Legacy migrated: ${match[1]}]`,
  };
}

export function hasManagedDefaultBinderMarker(description: string | null | undefined) {
  return (description?.trim() ?? "").endsWith(MANAGED_DEFAULT_BINDER_MARKER);
}

export function hasLegacyDefaultBinderMarker(description: string | null | undefined) {
  return (description?.trim() ?? "").endsWith(LEGACY_DEFAULT_BINDER_MARKER);
}

export function visibleBinderDescription(description: string | null | undefined) {
  const normalized = description?.trim() ?? "";
  const visible = normalized.replace(
    /(?:\s*\[(?:Legacy (?:source|migrated): [^\]]+|Managed binder: full-collection)])+\s*$/,
    "",
  ).trim();
  return visible || null;
}

export function withManagedDefaultBinderMarker(description: string | null | undefined) {
  const visible = visibleBinderDescription(description);
  return `${visible ? `${visible} ` : ""}${MANAGED_DEFAULT_BINDER_MARKER}`;
}

export function withLegacyDefaultBinderMarker(description: string | null | undefined) {
  const visible = visibleBinderDescription(description);
  return `${visible ? `${visible} ` : ""}${LEGACY_DEFAULT_BINDER_MARKER}`;
}

export function withLegacyCustomBinderMarker(
  description: string | null | undefined,
  legacySource: string,
) {
  const visible = visibleBinderDescription(description);
  return `${visible ? `${visible} ` : ""}[Legacy source: ${legacySource}]`;
}

export function preserveBinderDescriptionMarker(
  currentDescription: string | null | undefined,
  nextDescription: string | null | undefined,
) {
  if (hasManagedDefaultBinderMarker(currentDescription)) {
    return withManagedDefaultBinderMarker(nextDescription);
  }
  if (hasLegacyDefaultBinderMarker(currentDescription)) {
    return withLegacyDefaultBinderMarker(nextDescription);
  }

  const marker = currentDescription?.trim().match(/\[(?:Legacy source|Legacy migrated): [^\]]+]$/)?.[0];
  const visible = visibleBinderDescription(nextDescription);
  return marker
    ? `${visible ? `${visible} ` : ""}${marker}`
    : visible;
}

export function unassignedBinderEntries(
  collection: OwnedCardLotState[],
  binders: BinderAssignmentState[],
  excludedBinderIds?: string | string[],
) {
  const assignedCopies = assignedBinderCopyKeys(binders, excludedBinderIds);

  return collection.flatMap((item) => {
    const quantity = Math.max(0, Math.floor(item.quantity));
    for (let copyIndex = 1; copyIndex <= quantity; copyIndex += 1) {
      if (!assignedCopies.has(`${item.id}:${copyIndex}`)) {
        return [{ collectionItemId: item.id, copyIndex }];
      }
    }
    return [];
  });
}

export function unassignedBinderCopyIndexes(
  item: OwnedCardLotState,
  binders: BinderAssignmentState[],
  excludedBinderIds?: string | string[],
) {
  const assignedCopies = assignedBinderCopyKeys(binders, excludedBinderIds);
  const quantity = Math.max(0, Math.floor(item.quantity));
  return Array.from({ length: quantity }, (_entry, index) => index + 1)
    .filter((copyIndex) => !assignedCopies.has(`${item.id}:${copyIndex}`));
}

function assignedBinderCopyKeys(
  binders: BinderAssignmentState[],
  excludedBinderIds?: string | string[],
) {
  const assignedCopies = new Set<string>();
  const excludedIds = new Set(
    typeof excludedBinderIds === "string"
      ? [excludedBinderIds]
      : excludedBinderIds ?? [],
  );

  for (const binder of binders) {
    if (excludedIds.has(binder.id)) continue;

    for (const page of binder.pages) {
      for (const slot of page.slots) {
        if (!slot.collectionItemId) continue;
        const copyIndex = Number.isSafeInteger(slot.copyIndex) && Number(slot.copyIndex) > 0
          ? Number(slot.copyIndex)
          : 1;
        assignedCopies.add(`${slot.collectionItemId}:${copyIndex}`);
      }
    }
  }

  return assignedCopies;
}
