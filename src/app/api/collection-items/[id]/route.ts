import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { archiveCollectionItem, updateCollectionItem } from "@/lib/db/app-data";

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
    const item = await updateCollectionItem(session.user.id, id, body);

    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update collection item.";

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
    await archiveCollectionItem(session.user.id, id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to remove collection item.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
