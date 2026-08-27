import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import {
  BinderInputError,
  BinderVersionConflictError,
  replaceBinderLayout,
} from "@/lib/db/binders";
import { accountMutationGuard } from "@/lib/auth/mutation-guard";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
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
    const binder = await replaceBinderLayout(session.user.id, id, body, {
      completeLegacyCustomMigration: body?.completeLegacyCustomMigration === true,
      completeLegacyDefaultMigration: body?.completeLegacyDefaultMigration === true,
      expectedUpdatedAt: body?.expectedUpdatedAt,
      releaseConflictsFromDefaultBinderId: body?.releaseConflictsFromDefaultBinderId,
      releaseConflictsFromDefaultUpdatedAt: body?.releaseConflictsFromDefaultUpdatedAt,
    });

    return NextResponse.json({ binder });
  } catch (error) {
    if (error instanceof BinderVersionConflictError) {
      return NextResponse.json(
        { code: "BINDER_LAYOUT_STALE", error: error.message },
        { status: 409 },
      );
    }
    if (error instanceof BinderInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "One of these owned copies is already assigned to another binder. Refresh and try again." },
        { status: 409 },
      );
    }

    console.error("Unable to save binder layout.", error);
    return NextResponse.json({ error: "Unable to save binder layout." }, { status: 500 });
  }
}
