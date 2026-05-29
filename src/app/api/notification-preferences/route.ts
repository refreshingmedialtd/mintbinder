import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferenceUpdate,
} from "@/lib/notifications/preferences";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  return NextResponse.json(await getNotificationPreferences(session.user.id));
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as NotificationPreferenceUpdate;
    const preferences = await updateNotificationPreferences(session.user.id, body);

    return NextResponse.json(preferences);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update notification preferences.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
