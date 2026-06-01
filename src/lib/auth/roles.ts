export type AppUserRole = "USER" | "ADMIN";

export function normalizeAppRole(value: unknown): AppUserRole {
  return value === "ADMIN" ? "ADMIN" : "USER";
}

export function canUseOperations(value: unknown) {
  return normalizeAppRole(value) === "ADMIN";
}
