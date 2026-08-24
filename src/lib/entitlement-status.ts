export function entitlementStatus(error: unknown) {
  return error instanceof Error && error.name === "EntitlementError" ? 403 : 500;
}
