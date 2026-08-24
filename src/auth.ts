import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { sendVerificationEmail } from "@/lib/auth/account-tokens";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { passwordPolicyError } from "@/lib/auth/password-policy";
import {
  normalizeAccountDisplayName,
  normalizeAccountEmail,
} from "@/lib/auth/registration-input";
import {
  AuthRateLimitError,
  clearAuthFailures,
  consumeAuthAttempt,
} from "@/lib/auth/rate-limit";
import { normalizeAppRole, type AppUserRole } from "@/lib/auth/roles";
import { requiredAuthSecret } from "@/lib/auth/secret";
import {
  credentialsRegistrationAvailable,
  sessionVersionMatches,
} from "@/lib/auth/session-security";
import { prisma } from "@/lib/db/prisma";

const authSecret = requiredAuthSecret();

declare module "next-auth" {
  interface User {
    isEmailVerified?: boolean;
    role?: AppUserRole;
    sessionVersion?: number;
  }

  interface Session {
    user: {
      isEmailVerified: boolean;
      id: string;
      role: AppUserRole;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    isEmailVerified?: boolean;
    role?: AppUserRole;
    sessionVersion?: number;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret,
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    error: "/",
    signIn: "/",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        name: { label: "Name", type: "text" },
        mode: { label: "Mode", type: "text" },
      },
      async authorize(credentials, request) {
        const email = normalizeAccountEmail(credentials.email);
        const password = normalizePassword(credentials.password);
        const mode = credentials.mode === "register" ? "register" : "sign-in";
        const displayNameInput = mode === "register"
          ? normalizeAccountDisplayName(credentials.name)
          : { valid: true, value: null };
        const rateLimitContext = {
          action: "credentials" as const,
          email,
          request,
        };

        try {
          // Reserve the attempt atomically before user lookup and password work.
          // A successful authentication clears it; every unsuccessful path keeps it.
          const rateLimitReservation = await consumeAuthAttempt(rateLimitContext);

          if (
            !email ||
            !password ||
            (mode === "register" && (!displayNameInput.valid || passwordPolicyError(password)))
          ) {
            return null;
          }

          const existingUser = await prisma.user.findUnique({
            where: { email },
            select: {
              id: true,
              email: true,
              displayName: true,
              emailVerifiedAt: true,
              passwordHash: true,
              role: true,
              sessionVersion: true,
            },
          });

          if (mode === "register") {
            // Perform the same expensive password work before deciding whether an
            // address can register, reducing email-enumeration timing differences.
            const passwordHash = await hashPassword(password);

            if (!credentialsRegistrationAvailable(existingUser)) {
              return null;
            }

            const displayName = displayNameInput.value ?? defaultNameFromEmail(email);
            const user = await prisma.user.create({
              data: {
                email,
                displayName,
                passwordHash,
                preferredCurrency: "GBP",
                preferredRegion: "United Kingdom",
                notificationPreference: {
                  create: {},
                },
                subscriptions: {
                  create: {
                    provider: "local",
                    plan: SubscriptionPlan.FREE,
                    status: SubscriptionStatus.ACTIVE,
                  },
                },
              },
              select: {
                id: true,
                email: true,
                displayName: true,
                emailVerifiedAt: true,
                role: true,
                sessionVersion: true,
              },
            });
            await clearAuthFailures(rateLimitReservation).catch((error) => {
              console.warn("Unable to clear successful registration throttle.", error);
            });
            await sendVerificationEmail(user).catch((error) => {
              console.warn("Account created, but the verification email could not be sent.", error);
            });

            return {
              id: user.id,
              email: user.email,
              isEmailVerified: user.emailVerifiedAt !== null,
              name: user.displayName ?? defaultNameFromEmail(user.email),
              role: normalizeAppRole(user.role),
              sessionVersion: user.sessionVersion,
            };
          }

          const passwordMatches = existingUser?.passwordHash
            ? await verifyPassword(password, existingUser.passwordHash)
            : await consumeMissingUserPasswordWork(password);

          if (!existingUser || !passwordMatches) {
            return null;
          }

          await clearAuthFailures(rateLimitReservation).catch((error) => {
            console.warn("Unable to clear successful sign-in throttle.", error);
          });

          return {
            id: existingUser.id,
            email: existingUser.email,
            isEmailVerified: existingUser.emailVerifiedAt !== null,
            name: existingUser.displayName ?? defaultNameFromEmail(existingUser.email),
            role: normalizeAppRole(existingUser.role),
            sessionVersion: existingUser.sessionVersion,
          };
        } catch (error) {
          if (!(error instanceof AuthRateLimitError)) {
            console.error("Credentials authentication failed.", error);
          }

          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.isEmailVerified = user.isEmailVerified === true;
        token.role = normalizeAppRole(user.role);
        token.sessionVersion = user.sessionVersion ?? 0;
      } else if (token.sub) {
        const claims = await currentUserSessionClaims(token.sub, {
          isEmailVerified: token.isEmailVerified,
          role: token.role,
          sessionVersion: token.sessionVersion,
        });

        if (claims === null) {
          return null;
        }

        token.isEmailVerified = claims.isEmailVerified;
        token.role = claims.role;
        token.sessionVersion = claims.sessionVersion;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.isEmailVerified = token.isEmailVerified === true;
        session.user.id = token.sub;
        session.user.role = normalizeAppRole(token.role);
      }

      return session;
    },
  },
});

function normalizePassword(value: unknown) {
  const password = typeof value === "string" ? value : "";

  return password.length >= 8 ? password : null;
}

function defaultNameFromEmail(email: string) {
  return email.split("@")[0] || "Collector";
}

async function consumeMissingUserPasswordWork(password: string) {
  await hashPassword(password);
  return false;
}

async function currentUserSessionClaims(
  userId: string,
  fallback: { isEmailVerified?: boolean; role?: AppUserRole; sessionVersion?: number },
) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true, role: true, sessionVersion: true },
    });

    if (!user || !sessionVersionMatches(user.sessionVersion, fallback.sessionVersion)) {
      return null;
    }

    return {
      isEmailVerified: user.emailVerifiedAt !== null,
      role: normalizeAppRole(user.role),
      sessionVersion: user.sessionVersion,
    };
  } catch (error) {
    console.warn("Unable to refresh user session claims.", error);
    return null;
  }
}
