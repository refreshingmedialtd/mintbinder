import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sellCollectionItem } from "@/lib/db/app-data";
import { accountMutationGuard } from "@/lib/auth/mutation-guard";
import { mutationErrorResponse } from "@/lib/http/mutation-error-response";

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
    const mutationError = await accountMutationGuard({
      isEmailVerified: session.user.isEmailVerified, request, userId: session.user.id,
    });
    if (mutationError) return mutationError;

    const { id } = await context.params;
    const body = await request.json();

    await sellCollectionItem(session.user.id, id, body);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return mutationErrorResponse(error, "Unable to record sale.");
  }
}
