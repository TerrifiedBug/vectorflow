export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_VF_DEMO_MODE === "true";
}
