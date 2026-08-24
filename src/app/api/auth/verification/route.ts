import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  AccountTokenError,
  sendVerificationEmail,
  verifyEmailWithToken,
} from "@/lib/auth/account-tokens";
import {
  AuthRateLimitError,
  clearAuthFailures,
  consumeAuthAttempt,
} from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, displayName: true, emailVerifiedAt: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    if (user.emailVerifiedAt) {
      return NextResponse.json({ ok: true, message: "Email is already verified." });
    }

    const context = { action: "verification" as const, email: user.email, request };
    await consumeAuthAttempt(context);
    await sendVerificationEmail(user);

    return NextResponse.json({ ok: true, message: "Verification email sent." });
  } catch (error) {
    if (error instanceof AuthRateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }

    console.error("Unable to send verification email.", error);
    return NextResponse.json({ error: "Verification email is temporarily unavailable." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const context = { action: "verification-confirm" as const, request };

  try {
    const rateLimitReservation = await consumeAuthAttempt(context);
    const body = await request.json().catch(() => ({})) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token : "";

    await verifyEmailWithToken(token);
    await clearAuthFailures(rateLimitReservation);

    return NextResponse.json({ ok: true, message: "Email verified. You can return to Mint Binder." });
  } catch (error) {
    if (error instanceof AccountTokenError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof AuthRateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }

    console.error("Unable to verify email.", error);
    return NextResponse.json({ error: "Email verification is temporarily unavailable." }, { status: 503 });
  }
}
