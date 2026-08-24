import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { BinderInputError, createBinder, listBinders } from "@/lib/db/binders";
import { UserQuotaExceededError } from "@/lib/db/user-quotas";
import { accountMutationGuard } from "@/lib/auth/mutation-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  return NextResponse.json({ binders: await listBinders(session.user.id) });
}

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

    const body = await request.json().catch(() => ({}));
    const binder = await createBinder(session.user.id, body);

    return NextResponse.json({ binder }, { status: 201 });
  } catch (error) {
    return binderErrorResponse(error, "Unable to create binder.");
  }
}

function binderErrorResponse(error: unknown, fallback: string) {
  if (error instanceof UserQuotaExceededError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: { "retry-after": String(error.retryAfterSeconds) } },
    );
  }
  if (error instanceof BinderInputError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json(
      { error: "A binder name already exists or its default changed concurrently. Refresh and try again." },
      { status: 409 },
    );
  }

  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
