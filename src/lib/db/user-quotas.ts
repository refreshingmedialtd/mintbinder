import { Prisma } from "@prisma/client";

export const USER_RESOURCE_LIMITS = Object.freeze({
  binders: 50,
  collectionEvents: 100_000,
  collectionLots: 5_000,
  collectionRows: 25_000,
  manualSealedProducts: 500,
  storageLocations: 250,
  wishlistItems: 2_000,
});

export class UserQuotaExceededError extends Error {
  retryAfterSeconds = 3_600;
  status = 429;

  constructor(resource: string, limit: number) {
    super(`This account has reached the ${resource} limit (${limit.toLocaleString("en-GB")}). Remove an existing item before adding another.`);
    this.name = "UserQuotaExceededError";
  }
}

export async function lockUserResourceQuota(
  transaction: Pick<Prisma.TransactionClient, "$executeRaw">,
  userId: string,
  resource: keyof typeof USER_RESOURCE_LIMITS,
) {
  await transaction.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`mintbinder-quota:${userId}:${resource}`}, 0::bigint))
  `);
}

export function assertUserResourceQuota(
  count: number,
  resource: keyof typeof USER_RESOURCE_LIMITS,
) {
  const limit = USER_RESOURCE_LIMITS[resource];
  if (count >= limit) throw new UserQuotaExceededError(resourceLabel(resource), limit);
}

export function assertUserResourceCapacity(
  currentCount: number,
  additions: number,
  resource: keyof typeof USER_RESOURCE_LIMITS,
) {
  const limit = USER_RESOURCE_LIMITS[resource];
  if (currentCount + Math.max(0, additions) > limit) {
    throw new UserQuotaExceededError(resourceLabel(resource), limit);
  }
}

export function quotaErrorStatus(error: unknown) {
  return error instanceof UserQuotaExceededError ? error.status : undefined;
}

function resourceLabel(resource: keyof typeof USER_RESOURCE_LIMITS) {
  return resource.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}
