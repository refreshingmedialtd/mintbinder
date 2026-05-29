import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sellCollectionItem } from "@/lib/db/app-data";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();

    await sellCollectionItem(session.user.id, id, body);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to record sale.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
