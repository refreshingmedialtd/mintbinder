export function credentialsRegistrationAvailable(existingUser: unknown) {
  return existingUser === null || existingUser === undefined;
}

export function passwordResetSessionUpdate(passwordHash: string) {
  return {
    passwordHash,
    sessionVersion: { increment: 1 as const },
  };
}

export function sessionVersionMatches(currentVersion: number, tokenVersion?: number) {
  return currentVersion === (tokenVersion ?? 0);
}
