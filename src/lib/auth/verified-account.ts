import { NextResponse } from "next/server";

export function emailVerificationRequiredResponse(isEmailVerified: boolean | undefined) {
  return isEmailVerified
    ? null
    : NextResponse.json(
        { error: "Verify your email address before changing account data." },
        { status: 403 },
      );
}
