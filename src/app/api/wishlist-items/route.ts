import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createWishlistItem, deleteWishlistItem, updateWishlistItem } from "@/lib/db/app-data";
import { accountMutationGuard } from "@/lib/auth/mutation-guard";
import { mutationErrorResponse } from "@/lib/http/mutation-error-response";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const mutationError = await accountMutationGuard({
      isEmailVerified: session.user.isEmailVerified, request, userId: session.user.id,
    });
    if (mutationError) return mutationError;

    const body = await request.json();
    const item = await createWishlistItem(session.user.id, String(body.catalogueId ?? ""));

    return NextResponse.json({ item });
  } catch (error) {
    return mutationErrorResponse(error, "Unable to create wishlist item.");
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const mutationError = await accountMutationGuard({
      isEmailVerified: session.user.isEmailVerified, request, userId: session.user.id,
    });
    if (mutationError) return mutationError;

    const id = new URL(request.url).searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Wishlist item id is required." }, { status: 400 });
    }

    await deleteWishlistItem(session.user.id, id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return mutationErrorResponse(error, "Unable to delete wishlist item.");
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const mutationError = await accountMutationGuard({
      isEmailVerified: session.user.isEmailVerified, request, userId: session.user.id,
    });
    if (mutationError) return mutationError;

    const body = await request.json();
    const id = String(body.id ?? "");

    if (!id) {
      return NextResponse.json({ error: "Wishlist item id is required." }, { status: 400 });
    }

    const item = await updateWishlistItem(session.user.id, id, body);

    return NextResponse.json({ item });
  } catch (error) {
    return mutationErrorResponse(error, "Unable to update wishlist item.");
  }
}
