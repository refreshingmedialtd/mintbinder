export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigError";
  }
}

export function billingErrorStatus(error: unknown) {
  return error instanceof BillingConfigError ? 501 : 400;
}
