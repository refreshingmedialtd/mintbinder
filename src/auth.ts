import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
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
        name: { label: "Name", type: "text" },
      },
      async authorize(credentials) {
        const email = normalizeEmail(credentials.email);

        if (!email) {
          return null;
        }

        const displayName = normalizeDisplayName(credentials.name) ?? defaultNameFromEmail(email);
        const user = await prisma.user.upsert({
          where: { email },
          update: { displayName },
          create: {
            email,
            displayName,
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
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.displayName ?? defaultNameFromEmail(user.email),
        };
      },
    }),
  ],
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
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

function defaultNameFromEmail(email: string) {
  return email.split("@")[0] || "Collector";
}
