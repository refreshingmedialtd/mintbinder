export type AppUserRole = "USER" | "ADMIN";

const OPERATIONS_OWNER_EMAILS = new Set(["liam@refreshing.media"]);

export function normalizeAppRole(value: unknown): AppUserRole {
  return value === "ADMIN" ? "ADMIN" : "USER";
}

export function canUseOperations(value: unknown) {
  return normalizeAppRole(value) === "ADMIN";
}

export function isOperationsOwnerEmail(value: unknown) {
  return typeof value === "string" && OPERATIONS_OWNER_EMAILS.has(value.trim().toLowerCase());
}

export function canUseOperationsForUser(role: unknown, email: unknown) {
  return canUseOperations(role) || isOperationsOwnerEmail(email);
}
