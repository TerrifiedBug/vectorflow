"use client";

import { LazyMotionProvider } from "@/components/motion/lazy-motion-provider";

/**
 * Auth layout with branded gradient background and LazyMotion support.
 *
 * The gradient uses the pipeline node oklch colors (source green → transform blue)
 * at very low alpha to subtly tie the login page to the product's visual identity.
 * Dark mode uses the darker node color variants at slightly higher alpha for visibility.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`
        [data-auth-bg] {
          background:
            linear-gradient(
              135deg,
              oklch(0.65 0.18 145 / 5%),
              oklch(0.60 0.15 250 / 5%)
            ),
            var(--background);
        }
        .dark [data-auth-bg] {
          background:
            linear-gradient(
              135deg,
              oklch(0.50 0.15 145 / 8%),
              oklch(0.45 0.12 250 / 8%)
            ),
            var(--background);
        }
      `}</style>
      <div
        data-auth-bg
        className="flex min-h-screen items-center justify-center p-4"
      >
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-3xl tracking-tight text-balance">
              <span className="font-bold">Vector</span>
              <span className="font-light">Flow</span>
              <span
                className="ml-0.5 inline-block h-2 w-2 rounded-full align-super"
                style={{ background: "oklch(0.65 0.18 145)" }}
                aria-hidden="true"
              />
            </h1>
            <p className="text-sm text-muted-foreground text-pretty">
              Visual pipeline builder for Vector
            </p>
          </div>
          <LazyMotionProvider>{children}</LazyMotionProvider>
        </div>
      </div>
    </>
  );
}
