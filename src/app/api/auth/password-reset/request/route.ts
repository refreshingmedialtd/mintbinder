import { NextResponse } from "next/server";
import { enqueuePasswordResetRequest } from "@/lib/auth/password-reset-outbox";
import { AuthRateLimitError, consumeAuthAttempt } from "@/lib/auth/rate-limit";
import { normalizeAccountEmail } from "@/lib/auth/registration-input";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { email?: unknown };
  const email = normalizeAccountEmail(body.email);
  const context = { action: "password-reset" as const, email, request };

  try {
    await consumeAuthAttempt(context);

    await enqueuePasswordResetRequest(email);

    return acceptedResponse();
  } catch (error) {
    if (error instanceof AuthRateLimitError) {
      return acceptedResponse({ "retry-after": String(error.retryAfterSeconds) });
    }

    console.error("Unable to request password reset.", error);
    return NextResponse.json({ error: "Password reset is temporarily unavailable." }, { status: 503 });
  }
}

function acceptedResponse(headers: Record<string, string> = {}) {
  return NextResponse.json(
    {
      accepted: true,
      message: "If an account exists for that email, a reset link will be sent shortly.",
    },
    {
      status: 202,
      headers: { "cache-control": "no-store", ...headers },
    },
  );
}
