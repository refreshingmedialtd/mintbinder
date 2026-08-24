import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deleteActiveSetGoal,
  getActiveSetGoal,
  putActiveSetGoal,
  SetBuilderInputError,
} from "@/lib/db/set-builder";
import { accountMutationGuard } from "@/lib/auth/mutation-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    return NextResponse.json({ goal: await getActiveSetGoal(session.user.id) });
  } catch (error) {
    console.error("Unable to load the active set goal.", error);
    return NextResponse.json({ error: "Unable to load the active set goal." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
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
    const goal = await putActiveSetGoal(session.user.id, body);
    return NextResponse.json({ goal });
  } catch (error) {
    return setBuilderErrorResponse(error, "Unable to save the active set goal.");
  }
}

export async function DELETE(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const mutationError = await accountMutationGuard({
    isEmailVerified: session.user.isEmailVerified, request, userId: session.user.id,
  });
  if (mutationError) return mutationError;

  try {
    const deleted = await deleteActiveSetGoal(session.user.id);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    console.error("Unable to clear the active set goal.", error);
    return NextResponse.json({ error: "Unable to clear the active set goal." }, { status: 500 });
  }
}

function setBuilderErrorResponse(error: unknown, fallback: string) {
  if (error instanceof SetBuilderInputError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
