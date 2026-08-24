import { createHash } from "node:crypto";

export function billingCustomerCreationIdempotencyKey(provider: string, checkoutIntentKey: string) {
  const digest = createHash("sha256")
    .update(`mintbinder:${provider}:customer:${checkoutIntentKey}`)
    .digest("hex")
    .slice(0, 40);
  return `mbc_${digest}`;
}

export async function establishDurableProviderCustomer<T extends { id: string }>({
  compensate,
  create,
  finalize,
  shouldCompensate,
}: {
  compensate: (customerId: string) => Promise<unknown>;
  create: () => Promise<T>;
  finalize: (customer: T) => Promise<{ customerId: string; discardCreated: boolean }>;
  shouldCompensate: (error: unknown) => boolean;
}) {
  const customer = await create();

  try {
    const result = await finalize(customer);
    if (result.discardCreated) await compensate(customer.id);
    return result.customerId;
  } catch (error) {
    // Transient/ambiguous database failures deliberately retain the remote
    // object. A retry uses the same provider idempotency key and finalizes that
    // one customer. Fenced or cross-tenant rejections are definitive and must
    // compensate the newly created object immediately.
    if (!shouldCompensate(error)) throw error;

    try {
      await compensate(customer.id);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Unable to finalize or remove the newly created provider customer safely.",
      );
    }
    throw error;
  }
}
