import { NextResponse } from "next/server";
import { classifyMutationError } from "@/lib/http/mutation-error-classification";

export function mutationErrorResponse(error: unknown, fallback: string) {
  const classified = classifyMutationError(error);
  if (classified) {
    return NextResponse.json(
      { error: classified.message },
      {
        status: classified.status,
        headers: classified.retryAfterSeconds
          ? { "retry-after": String(classified.retryAfterSeconds) }
          : undefined,
      },
    );
  }

  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
