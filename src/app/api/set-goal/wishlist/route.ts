import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { accountMutationGuard } from "@/lib/auth/mutation-guard";
import {
  bulkAddActiveSetWishlist,
  SetBuilderInputError,
} from "@/lib/db/set-builder";
import { UserQuotaExceededError } from "@/lib/db/user-quotas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const mutationError = await accountMutationGuard({
    isEmailVerified: session.user.isEmailVerified, request, userId: session.user.id,
  });
  if (mutationError) return mutationError;

  try {
    const body = await request.json().catch(() => {
      throw new SetBuilderInputError("A valid JSON object is required.");
    });
    const result = await bulkAddActiveSetWishlist(session.user.id, body);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof UserQuotaExceededError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    if (error instanceof SetBuilderInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Unable to bulk-add the active set wishlist.", error);
    return NextResponse.json(
      { error: "Unable to bulk-add the active set wishlist." },
      { status: 500 },
    );
  }
}
