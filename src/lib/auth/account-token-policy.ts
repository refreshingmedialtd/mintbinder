export type AccountTokenIssueCleanupFilter = {
  expiresAt?: { lte: Date };
  usedAt?: null;
};

/**
 * Password-reset links already accepted by an email provider must remain
 * usable if a later message is delivered first. Issuing a reset token therefore
 * removes only expired, unused siblings; successful consumption still
 * invalidates every other reset token for the account.
 */
export function accountTokenIssueCleanupFilter(
  type: string,
  now: Date,
): AccountTokenIssueCleanupFilter {
  if (type === "PASSWORD_RESET") {
    return {
      expiresAt: { lte: now },
      usedAt: null,
    };
  }

  // Preserve the pre-existing verification-token rotation behaviour.
  return { usedAt: null };
}
