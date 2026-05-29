import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createStorageLocation } from "@/lib/db/app-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json();
    const location = await createStorageLocation(session.user.id, body);

    return NextResponse.json({ location });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create storage location.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
