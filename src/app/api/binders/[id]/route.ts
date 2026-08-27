import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import {
  BinderInputError,
  BinderVersionConflictError,
  deleteBinder,
  getBinder,
  updateBinder,
} from "@/lib/db/binders";
import { accountMutationGuard } from "@/lib/auth/mutation-guard";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { id } = await context.params;
    return NextResponse.json({ binder: await getBinder(session.user.id, id) });
  } catch (error) {
    return binderErrorResponse(error, "Unable to load binder.");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
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
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ binder: await updateBinder(session.user.id, id, body) });
  } catch (error) {
    return binderErrorResponse(error, "Unable to update binder.");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
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
    const body = await request.json().catch(() => ({}));
    await deleteBinder(session.user.id, id, body?.expectedUpdatedAt);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return binderErrorResponse(error, "Unable to delete binder.");
  }
}

function binderErrorResponse(error: unknown, fallback: string) {
  if (error instanceof BinderVersionConflictError) {
    return NextResponse.json(
      { code: "BINDER_STALE", error: error.message },
      { status: 409 },
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
