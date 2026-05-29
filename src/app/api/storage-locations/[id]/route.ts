import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteStorageLocation, updateStorageLocation } from "@/lib/db/app-data";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const location = await updateStorageLocation(session.user.id, id, body);

    return NextResponse.json({ location });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update storage location.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { id } = await context.params;
    await deleteStorageLocation(session.user.id, id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete storage location.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
