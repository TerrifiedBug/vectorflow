import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /**
       * Organisation this session was issued for. Set by auth.ts's jwt
       * callback and forwarded to the session in both Node.js and Edge
       * middleware contexts (auth.ts + auth.config.ts).
       */
      org_id: string;
    } & DefaultSession["user"];
  }
}
