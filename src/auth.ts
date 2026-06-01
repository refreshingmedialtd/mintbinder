import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { normalizeAppRole, type AppUserRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";

declare module "next-auth" {
  interface User {
    role?: AppUserRole;
  }

  interface Session {
    user: {
      id: string;
      role: AppUserRole;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
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
      async authorize(credentials) {
        const email = normalizeEmail(credentials.email);
        const password = normalizePassword(credentials.password);
        const mode = credentials.mode === "register" ? "register" : "sign-in";

        if (!email || !password) {
          return null;
        }

        const existingUser = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            displayName: true,
            passwordHash: true,
            role: true,
          },
        });

        if (mode === "register") {
          if (existingUser?.passwordHash) {
            return null;
          }

          const displayName = normalizeDisplayName(credentials.name) ?? defaultNameFromEmail(email);
          const passwordHash = hashPassword(password);
          const user = existingUser
            ? await prisma.user.update({
                where: { email },
                data: { displayName, passwordHash },
                select: { id: true, email: true, displayName: true, role: true },
              })
            : await prisma.user.create({
                data: {
                  email,
                  displayName,
                  passwordHash,
                  preferredCurrency: "GBP",
                  preferredRegion: "United Kingdom",
                  subscriptions: {
                    create: {
                      provider: "local",
                      plan: SubscriptionPlan.FREE,
                      status: SubscriptionStatus.ACTIVE,
                    },
                  },
                },
                select: { id: true, email: true, displayName: true, role: true },
              });

          return {
            id: user.id,
            email: user.email,
            name: user.displayName ?? defaultNameFromEmail(user.email),
            role: normalizeAppRole(user.role),
          };
        }

        if (!existingUser?.passwordHash || !verifyPassword(password, existingUser.passwordHash)) {
          return null;
        }

        return {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.displayName ?? defaultNameFromEmail(existingUser.email),
          role: normalizeAppRole(existingUser.role),
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        (token as { role?: AppUserRole }).role = normalizeAppRole(user.role);
      }

      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = normalizeAppRole((token as { role?: AppUserRole }).role);
      }

      return session;
    },
  },
});

function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";

  return email.includes("@") ? email : null;
}

function normalizeDisplayName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";

  return name || null;
}

function normalizePassword(value: unknown) {
  const password = typeof value === "string" ? value : "";

  return password.length >= 8 ? password : null;
}

function defaultNameFromEmail(email: string) {
  return email.split("@")[0] || "Collector";
}
