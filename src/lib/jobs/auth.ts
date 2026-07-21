import { timingSafeEqual } from "node:crypto";
import { auth } from "@/auth";
import { canUseOperationsForUser } from "@/lib/auth/roles";

export class JobConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobConfigError";
  }
}

export class JobAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobAuthError";
  }
}

export function requireJobSecret(request: Request) {
  if (hasValidJobSecret(request)) {
    return;
  }

  if (!process.env.JOB_SECRET) {
    throw new JobConfigError("JOB_SECRET is not configured.");
  }

  throw new JobAuthError("Job authentication failed.");
}

export async function requireJobAccess(request: Request) {
  if (hasValidJobSecret(request)) {
    return;
  }

  const session = await auth();

  if (canUseOperationsForUser(session?.user?.role)) {
    return;
  }

  if (!process.env.JOB_SECRET) {
    throw new JobConfigError("JOB_SECRET is not configured.");
  }

  throw new JobAuthError("Job authentication failed.");
}

function hasValidJobSecret(request: Request) {
  const expected = process.env.JOB_SECRET;

  if (!expected) {
    return false;
  }

  const provided = bearerToken(request.headers.get("authorization")) ?? request.headers.get("x-job-secret");

  if (!provided) {
    return false;
  }

  return constantTimeEqual(provided, expected);
}

export function jobErrorStatus(error: unknown) {
  if (error instanceof JobConfigError) {
    return 501;
  }

  if (error instanceof JobAuthError) {
    return 401;
  }

  return 400;
}

function bearerToken(value: string | null) {
  if (!value?.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return value.slice(7).trim();
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
