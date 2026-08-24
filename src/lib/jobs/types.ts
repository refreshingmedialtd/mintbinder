export type JobRunType =
  | "billing_checkout_retirement"
  | "password_reset_delivery"
  | "price_alerts"
  | "catalogue_refresh"
  | "pricing_refresh"
  | "sealed_pricing_refresh";

export type JobRunStatus = "running" | "succeeded" | "failed";

export function isJobRunType(value: string | null): value is JobRunType {
  return (
    value === "billing_checkout_retirement" ||
    value === "password_reset_delivery" ||
    value === "price_alerts" ||
    value === "catalogue_refresh" ||
    value === "pricing_refresh" ||
    value === "sealed_pricing_refresh"
  );
}
