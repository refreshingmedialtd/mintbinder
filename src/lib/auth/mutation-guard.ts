import { NextResponse } from "next/server";
import { consumeUserMutationAttempt, AuthRateLimitError } from "@/lib/auth/rate-limit";
import { emailVerificationRequiredResponse } from "@/lib/auth/verified-account";

export async function accountMutationGuard({
  isEmailVerified,
  request,
  userId,
}: {
  isEmailVerified: boolean | undefined;
  request: Request;
  userId: string;
}) {
  const verificationError = emailVerificationRequiredResponse(isEmailVerified);
  if (verificationError) return verificationError;

  try {
    await consumeUserMutationAttempt({ request, userId });
    return null;
  } catch (error) {
    if (error instanceof AuthRateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    throw error;
  }
}
