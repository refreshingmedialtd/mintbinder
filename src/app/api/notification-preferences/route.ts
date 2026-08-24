import { auth } from "@/auth";
import {
  getNotificationPreferences,
  NotificationPreferenceValidationError,
  updateNotificationPreferences,
} from "@/lib/notifications/preferences";
import {
  databaseReadUnavailableResponse,
  privateReadJson,
} from "@/lib/http/private-read-response";
import { accountMutationGuard } from "@/lib/auth/mutation-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return privateReadJson({ error: "Authentication required." }, 401);
    }
    return privateReadJson(await getNotificationPreferences(session.user.id, { fallback: "throw" }));
  } catch (error) {
    console.error("Unable to read notification preferences.", error);
    return databaseReadUnavailableResponse("Notification preferences are temporarily unavailable.");
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return privateReadJson({ error: "Authentication required." }, 401);
    }
    const mutationError = await accountMutationGuard({
      isEmailVerified: session.user.isEmailVerified, request, userId: session.user.id,
    });
    if (mutationError) return mutationError;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return privateReadJson({ error: "A JSON body is required." }, 400);
    }

    const preferences = await updateNotificationPreferences(session.user.id, body);

    return privateReadJson(preferences);
  } catch (error) {
    if (error instanceof NotificationPreferenceValidationError) {
      return privateReadJson({ error: error.message }, 400);
    }

    console.error("Unable to update notification preferences.", error);
    return databaseReadUnavailableResponse("Notification preferences are temporarily unavailable.");
  }
}
