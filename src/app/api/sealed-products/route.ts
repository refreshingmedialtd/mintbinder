import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createSealedProduct, deleteManualSealedProduct } from "@/lib/db/app-data";
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
    const item = await createSealedProduct(session.user.id, body);

    return NextResponse.json({ item });
  } catch (error) {
    return mutationErrorResponse(error, "Unable to create sealed product.");
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

    const id = new URL(request.url).searchParams.get("id") ?? "";
    await deleteManualSealedProduct(session.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mutationErrorResponse(error, "Unable to delete sealed product.");
  }
}
