import { canUseOperationsForUser } from "../auth/roles.ts";

export function hasInsuranceReportTesterAccess(role: unknown) {
  return canUseOperationsForUser(role);
}
