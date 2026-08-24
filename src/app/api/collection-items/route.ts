import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createCollectionItem } from "@/lib/db/app-data";
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
    const item = await createCollectionItem(session.user.id, body);

    return NextResponse.json({ item });
  } catch (error) {
    return mutationErrorResponse(error, "Unable to create collection item.");
  }
}
