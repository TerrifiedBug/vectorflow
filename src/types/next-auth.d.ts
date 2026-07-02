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
      /**
       * Epoch millis of the last interactive sign-in (set by the jwt callback
       * when an account is present). Lets sensitive mutations — e.g. OIDC
       * self-erasure — require a recent re-authentication.
       */
      authedAt?: number;
      /**
       * Coarse suite-wide role stamped into the JWT at sign-in (see
       * VfJwtPayload.suite_role). Used by co-deployed suite apps (CHAD);
       * VF's own authz continues to use OrgMember/TeamMember directly.
       */
      suite_role?: "admin" | "editor" | "viewer";
    } & DefaultSession["user"];
  }
}
