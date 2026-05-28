import { NextResponse } from "next/server";
import { createCollectionItem } from "@/lib/db/app-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const item = await createCollectionItem(body);

    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create collection item.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

