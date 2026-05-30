import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthSessionProvider } from "@/components/session-provider";
import { NonceProvider } from "@/components/nonce-provider";
import { TRPCClientProvider } from "@/trpc/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getCspNonce } from "@/lib/csp-nonce";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "VectorFlow",
  description: "Visual pipeline management for Vector",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Per-request CSP nonce (strict multi-tenant mode only); empty in OSS mode.
  const nonce = await getCspNonce();
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
        style={{
          fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          "--font-sans": "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          "--font-mono": "var(--font-jetbrains-mono), 'SF Mono', Menlo, monospace",
        } as React.CSSProperties}
      >
        <a href="#main-content" className="skip-to-content">Skip to content</a>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <NonceProvider nonce={nonce}>
            <AuthSessionProvider>
              <TRPCClientProvider>
                <TooltipProvider>
                  {children}
                </TooltipProvider>
              </TRPCClientProvider>
            </AuthSessionProvider>
          </NonceProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
