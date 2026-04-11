import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import { PgAdapter } from "./adapter";
import { sendVerificationRequest } from "./email";

export const authConfig: NextAuthConfig = {
  adapter: PgAdapter(),
  providers: [
    {
      id: "email",
      name: "Email",
      type: "email",
      maxAge: 24 * 60 * 60, // 24 hours
      sendVerificationRequest,
      from: "noreply@cambridgetcg.com",
      options: {},
    },
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
  },
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
