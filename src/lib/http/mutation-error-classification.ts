import { CollectionMutationInputError } from "../collection/mutations.ts";
import { AppMutationError } from "../db/app-data.ts";
import { PersistedInputError } from "../db/input-validation.ts";
import { UserQuotaExceededError } from "../db/user-quotas.ts";

export function classifyMutationError(error: unknown) {
  if (error instanceof UserQuotaExceededError) {
    return {
      message: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
      status: error.status,
    };
  }
  if (
    error instanceof AppMutationError ||
    error instanceof CollectionMutationInputError ||
    error instanceof PersistedInputError
  ) {
    return { message: error.message, status: error.status };
  }
  return null;
}
