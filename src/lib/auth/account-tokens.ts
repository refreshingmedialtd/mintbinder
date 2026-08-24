import { createHash, randomBytes } from "node:crypto";
import { AccountTokenType, type Prisma } from "@prisma/client";
import { accountTokenIssueCleanupFilter } from "@/lib/auth/account-token-policy";
import { hashPassword } from "@/lib/auth/password";
import { passwordPolicyError } from "@/lib/auth/password-policy";
import { passwordResetSessionUpdate } from "@/lib/auth/session-security";
import { accountTokenUrl } from "@/lib/auth/token-links";
import { prisma } from "@/lib/db/prisma";
import { isEmailConfigured, sendEmail } from "@/lib/notifications/email";

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export class AccountTokenError extends Error {
  constructor(message = "This account link is invalid or has expired.") {
    super(message);
    this.name = "AccountTokenError";
  }
}

export async function sendPasswordResetEmail(user: { displayName: string | null; email: string; id: string }) {
  const token = await createAccountToken(user.id, AccountTokenType.PASSWORD_RESET, PASSWORD_RESET_TTL_MS);
  const resetUrl = accountTokenUrl("/auth/reset-password", token, appUrl());

  if (!isEmailConfigured()) {
    throw new Error("Email delivery is not configured.");
  }

  return sendEmail({
    to: user.email,
    subject: "Reset your Mint Binder password",
    idempotencyKey: `password-reset-${tokenHash(token).slice(0, 24)}`,
    text: [
      `Hi ${user.displayName ?? "Collector"},`,
      "",
      "Use this link to reset your Mint Binder password:",
      resetUrl.toString(),
      "",
      "The link expires in 30 minutes. If you did not request it, you can ignore this email.",
    ].join("\n"),
    html: accountEmailHtml({
      heading: "Reset your password",
      intro: "A password reset was requested for your Mint Binder account.",
      actionLabel: "Choose a new password",
      actionUrl: resetUrl.toString(),
      expiry: "This link expires in 30 minutes.",
    }),
  });
}

export async function sendVerificationEmail(user: { displayName: string | null; email: string; id: string }) {
  const token = await createAccountToken(user.id, AccountTokenType.EMAIL_VERIFICATION, EMAIL_VERIFICATION_TTL_MS);
  const verificationUrl = accountTokenUrl("/auth/verify-email", token, appUrl());

  if (!isEmailConfigured()) {
    throw new Error("Email delivery is not configured.");
  }

  await sendEmail({
    to: user.email,
    subject: "Verify your Mint Binder email",
    idempotencyKey: `email-verification-${tokenHash(token).slice(0, 24)}`,
    text: [
      `Hi ${user.displayName ?? "Collector"},`,
      "",
      "Verify your Mint Binder email address using this link:",
      verificationUrl.toString(),
      "",
      "The link expires in 24 hours.",
    ].join("\n"),
    html: accountEmailHtml({
      heading: "Verify your email",
      intro: "Confirm this email address to finish securing your Mint Binder account.",
      actionLabel: "Verify email",
      actionUrl: verificationUrl.toString(),
      expiry: "This link expires in 24 hours.",
    }),
  });
}

export async function resetPasswordWithToken(token: string, password: string) {
  const policyError = passwordPolicyError(password);
  if (policyError) throw new AccountTokenError(policyError);

  const passwordHash = await hashPassword(password);
  await consumeAccountToken(token, AccountTokenType.PASSWORD_RESET, async (transaction, accountToken) => {
    await transaction.user.update({
      where: { id: accountToken.userId },
      data: passwordResetSessionUpdate(passwordHash),
    });
    await transaction.accountToken.deleteMany({
      where: {
        userId: accountToken.userId,
        type: AccountTokenType.PASSWORD_RESET,
        id: { not: accountToken.id },
      },
    });
  });
}

export async function verifyEmailWithToken(token: string) {
  await consumeAccountToken(token, AccountTokenType.EMAIL_VERIFICATION, async (transaction, accountToken) => {
    await transaction.user.update({ where: { id: accountToken.userId }, data: { emailVerifiedAt: new Date() } });
    await transaction.accountToken.deleteMany({
      where: {
        userId: accountToken.userId,
        type: AccountTokenType.EMAIL_VERIFICATION,
        id: { not: accountToken.id },
      },
    });
  });
}

async function createAccountToken(userId: string, type: AccountTokenType, ttlMs: number) {
  const token = randomBytes(32).toString("base64url");
  const issuedAt = new Date();

  await prisma.$transaction([
    prisma.accountToken.deleteMany({
      where: {
        userId,
        type,
        ...accountTokenIssueCleanupFilter(type, issuedAt),
      },
    }),
    prisma.accountToken.create({
      data: {
        userId,
        type,
        tokenHash: tokenHash(token),
        expiresAt: new Date(issuedAt.getTime() + ttlMs),
      },
    }),
  ]);

  return token;
}

async function consumeAccountToken(
  token: string,
  type: AccountTokenType,
  action: (
    transaction: Prisma.TransactionClient,
    accountToken: { id: string; userId: string },
  ) => Promise<void>,
) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    throw new AccountTokenError();
  }

  const hash = tokenHash(token);

  await prisma.$transaction(async (transaction) => {
    const now = new Date();
    const accountToken = await transaction.accountToken.findUnique({
      where: { tokenHash: hash },
      select: { expiresAt: true, id: true, type: true, usedAt: true, userId: true },
    });

    if (!accountToken || accountToken.type !== type || accountToken.usedAt || accountToken.expiresAt <= now) {
      throw new AccountTokenError();
    }

    const claim = await transaction.accountToken.updateMany({
      where: {
        expiresAt: { gt: now },
        id: accountToken.id,
        type,
        usedAt: null,
      },
      data: { usedAt: now },
    });

    if (claim.count !== 1) {
      throw new AccountTokenError();
    }

    await action(transaction, accountToken);
  });
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function appUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? "https://mintbinder.co.uk";
  const url = new URL(configured);

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Production app URL must use HTTPS.");
  }

  return url;
}

function accountEmailHtml({
  actionLabel,
  actionUrl,
  expiry,
  heading,
  intro,
}: {
  actionLabel: string;
  actionUrl: string;
  expiry: string;
  heading: string;
  intro: string;
}) {
  return `<!doctype html>
  <html lang="en"><body style="margin:0;background:#f4f0e8;color:#183039;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:auto;background:#ffffff;border-radius:18px;">
        <tr><td style="padding:32px;">
          <p style="margin:0 0 10px;color:#1f7a72;font-weight:700;">Mint Binder</p>
          <h1 style="margin:0 0 16px;font-size:24px;">${heading}</h1>
          <p style="margin:0 0 24px;line-height:1.6;">${intro}</p>
          <p style="margin:0 0 24px;"><a href="${actionUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#1f7a72;color:#ffffff;text-decoration:none;font-weight:700;">${actionLabel}</a></p>
          <p style="margin:0;color:#687478;font-size:13px;line-height:1.5;">${expiry} If you did not request this message, no action is required.</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}
