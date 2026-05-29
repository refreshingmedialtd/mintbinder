import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createSealedProduct } from "@/lib/db/app-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json();
    const item = await createSealedProduct(session.user.id, body);

    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create sealed product.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
