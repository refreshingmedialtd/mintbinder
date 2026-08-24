import { NextResponse } from "next/server";
import { AccountTokenError, resetPasswordWithToken } from "@/lib/auth/account-tokens";
import {
  AuthRateLimitError,
  clearAuthFailures,
  consumeAuthAttempt,
} from "@/lib/auth/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = { action: "password-reset-confirm" as const, request };

  try {
    const body = await request.json().catch(() => ({})) as {
      password?: unknown;
      passwordConfirmation?: unknown;
      token?: unknown;
    };
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (password !== body.passwordConfirmation) {
      return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
    }

    const rateLimitReservation = await consumeAuthAttempt(context);
    await resetPasswordWithToken(token, password);
    await clearAuthFailures(rateLimitReservation);
    return NextResponse.json({ ok: true, message: "Password updated. You can now sign in." });
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

    console.error("Unable to reset password.", error);
    return NextResponse.json({ error: "Password reset is temporarily unavailable." }, { status: 503 });
  }
}
