import { env } from "./env";

export function isDemoMode(): boolean {
  return env.VF_DEMO_MODE;
}
