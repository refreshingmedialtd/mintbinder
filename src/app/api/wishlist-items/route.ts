import { NextResponse } from "next/server";
import { createWishlistItem, deleteWishlistItem } from "@/lib/db/app-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const item = await createWishlistItem(String(body.catalogueId ?? ""));

    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create wishlist item.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Wishlist item id is required." }, { status: 400 });
    }

    await deleteWishlistItem(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete wishlist item.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

