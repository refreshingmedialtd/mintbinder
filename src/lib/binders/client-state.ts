export const BINDER_SYNC_TIMEOUT_MS = 30_000;

export function shouldShowCollectionBinderFallback(
  serverBinderCount: number,
  activeCardLotCount: number,
) {
  return serverBinderCount === 0 && activeCardLotCount > 0;
}
