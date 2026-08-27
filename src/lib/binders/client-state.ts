export const BINDER_SYNC_TIMEOUT_MS = 30_000;

type BinderClientSlot = {
  collectionItemId: string | null;
  copyIndex: number | null;
  id?: string;
  note?: string | null;
  position: number;
};

type BinderClientPage = {
  id?: string;
  position: number;
  slots: BinderClientSlot[];
};

type BinderClientEntry = {
  collectionItemId: string;
  copyIndex: number;
};

export function appendBinderEntriesToBlankSlots(
  sourcePages: BinderClientPage[],
  entries: BinderClientEntry[],
  maxPages: number,
) {
  const pages = sourcePages.map((page) => ({
    ...page,
    slots: page.slots.map((slot) => ({ ...slot })),
  }));
  let placedCount = 0;

  for (const page of pages) {
    for (const slot of page.slots) {
      const entry = entries[placedCount];
      if (!entry) return { pages, placedCount };
      if (slot.collectionItemId || slot.note) continue;
      Object.assign(slot, { ...entry, note: null });
      placedCount += 1;
    }
  }

  while (placedCount < entries.length && pages.length < maxPages) {
    const pageEntries = entries.slice(placedCount, placedCount + 9);
    pages.push({
      position: pages.length,
      slots: Array.from({ length: 9 }, (_, position) => {
        const entry = pageEntries[position];
        return entry
          ? { ...entry, note: null, position }
          : { collectionItemId: null, copyIndex: null, note: null, position };
      }),
    });
    placedCount += pageEntries.length;
  }

  return { pages, placedCount };
}

export function binderOccupiedCopiesValueMinor<T extends { id: string; quantity: number }>(
  occupiedLots: T[],
  totalLotValueMinor: (item: T) => number | null | undefined,
) {
  const lots = new Map<string, { count: number; item: T }>();

  for (const item of occupiedLots) {
    const existing = lots.get(item.id);
    if (existing) {
      existing.count += 1;
    } else {
      lots.set(item.id, { count: 1, item });
    }
  }

  let total = 0;
  for (const { count, item } of lots.values()) {
    const lotValue = totalLotValueMinor(item);
    const quantity = Math.max(0, Math.floor(item.quantity));
    if (lotValue === null || lotValue === undefined || !Number.isFinite(lotValue) || quantity < 1) {
      continue;
    }

    total += Math.round((lotValue / quantity) * Math.min(count, quantity));
  }

  return total;
}

export function shouldShowCollectionBinderFallback(
  serverBinderCount: number,
  activeCardLotCount: number,
) {
  return serverBinderCount === 0 && activeCardLotCount > 0;
}

type MigratedBinderState = {
  isDefault: boolean;
  legacySource?: string;
  pages: Array<{
    slots: Array<{ collectionItemId?: string | null }>;
  }>;
};

export function shouldCompleteMigratedDefaultBinder(
  binders: MigratedBinderState[],
  activeCardLotCount: number,
) {
  if (activeCardLotCount < 1) return false;

  return binders.some((binder) =>
    binder.isDefault &&
    binder.legacySource === "default",
  );
}
