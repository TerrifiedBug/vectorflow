"use client";

import { LazyMotionProvider } from "@/components/motion/lazy-motion-provider";
import { StaggerList, StaggerItem } from "@/components/motion";

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
        <LazyMotionProvider>
          <div className="w-full max-w-md space-y-6">
            <StaggerList className="flex flex-col items-center gap-2 text-center">
              <StaggerItem>
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white"
                    style={{ background: "oklch(0.65 0.18 145)" }}
                    aria-hidden="true"
                  >
                    Vf
                  </div>
                  <h1 className="text-4xl tracking-tight text-balance">
                    <span className="font-bold">Vector</span>
                    <span className="font-light">Flow</span>
                  </h1>
                </div>
              </StaggerItem>
              <StaggerItem>
                <p className="text-sm text-muted-foreground text-pretty">
                  Enterprise control plane for Vector data pipelines
                </p>
              </StaggerItem>
            </StaggerList>
            {children}
          </div>
        </LazyMotionProvider>
      </div>
    </>
  );
}
