"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, Loader2, ShieldCheck, Users, BarChart3 } from "lucide-react";
import * as m from "motion/react-m";
import type { TargetAndTransition } from "motion/react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { fadeInUp } from "@/components/motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VFLogo } from "@/components/ui/vf-logo";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const setupStep1Schema = z
  .object({
    name: z.string().min(1, "Name is required."),
    email: z.string().email("Enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

type SetupStep1Values = z.infer<typeof setupStep1Schema>;
type Step = 1 | 2 | 3;

const STEPS = [
  {
    id: 1,
    title: "Admin account",
    description: "Create the first owner for this VectorFlow instance.",
    icon: ShieldCheck,
  },
  {
    id: 2,
    title: "Team setup",
    description: "Name the workspace that will own environments and pipelines.",
    icon: Users,
  },
  {
    id: 3,
    title: "Telemetry",
    description: "Choose whether to share anonymous operational stats.",
    icon: BarChart3,
  },
] as const;

/**
 * v2 first-run setup wizard (D6): left rail progress, 3-step right pane, existing /api/setup flow preserved.
 */
export default function SetupPage() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [telemetryChoice, setTelemetryChoice] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    fetch("/api/setup")
      .then((res) => res.json())
      .then((data: { setupRequired: boolean }) => {
        if (!data.setupRequired) router.replace("/login");
        else setReady(true);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  const form = useForm<SetupStep1Values>({
    resolver: zodResolver(setupStep1Schema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
    mode: "onBlur",
  });

  function handleNext() {
    setError(null);
    setStep(2);
  }

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    const step1Data = form.getValues();

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: step1Data.email,
          name: step1Data.name,
          password: step1Data.password,
          teamName,
          telemetryChoice,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Setup failed. Please try again.");
        return;
      }

      router.push("/login");
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) return null;

  const wizard = (
    <div className="min-h-[640px] overflow-hidden rounded-[3px] border border-line bg-bg-2 text-fg shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
      <div className="grid min-h-[640px] lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="border-b border-line bg-bg-1 p-8 lg:border-b-0 lg:border-r">
          <VFLogo size={30} mono />
          <div className="mt-10 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-2">
            first-run setup
          </div>
          <h1 className="mt-3 font-mono text-[24px] font-medium tracking-[-0.01em] text-fg">
            Bring your instance online.
          </h1>
          <p className="mt-3 text-[12px] leading-relaxed text-fg-1">
            Configure the initial owner, workspace, and telemetry preference. You can change everything later in Settings.
          </p>

          <div className="mt-10 space-y-0">
            {STEPS.map((item, index) => {
              const active = step === item.id;
              const complete = step > item.id;
              const Icon = item.icon;
              return (
                <div key={item.id} className="relative flex gap-3 pb-8 last:pb-0">
                  {index < STEPS.length - 1 && (
                    <div className="absolute left-[14px] top-8 h-[calc(100%-32px)] w-px bg-line-2" />
                  )}
                  <div
                    className={cn(
                      "z-10 flex h-7 w-7 items-center justify-center rounded-[3px] border font-mono text-[11px]",
                      complete
                        ? "border-accent-line bg-accent-soft text-accent-brand"
                        : active
                          ? "border-accent-brand bg-bg-3 text-fg"
                          : "border-line bg-bg-2 text-fg-2",
                    )}
                  >
                    {complete ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  </div>
                  <div className="min-w-0">
                    <div className={cn("font-mono text-[12px] font-medium", active ? "text-fg" : "text-fg-1")}>
                      {item.title}
                    </div>
                    <div className="mt-1 text-[11.5px] leading-relaxed text-fg-2">{item.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <main className="flex flex-col bg-bg p-6 sm:p-8">
          <div className="mb-8 flex items-center justify-between border-b border-line pb-4 font-mono text-[11px] text-fg-2">
            <span>step {step} / 3</span>
            <span>{STEPS[step - 1].title}</span>
          </div>

          <div className="flex-1">
            {error && (
              <div className="mb-4 rounded-[3px] border border-status-error/40 bg-status-error-bg px-3 py-2 font-mono text-[11.5px] text-status-error">
                {error}
              </div>
            )}
            {step === 1 ? (
              <AdminStep form={form} onSubmit={handleNext} />
            ) : step === 2 ? (
              <TeamStep teamName={teamName} setTeamName={setTeamName} onSubmit={() => setStep(3)} />
            ) : (
              <TelemetryStep choice={telemetryChoice} setChoice={setTelemetryChoice} />
            )}
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
            <Button
              type="button"
              variant="ghost"
              disabled={step === 1 || loading}
              onClick={() => setStep((current) => (current === 3 ? 2 : 1))}
            >
              Back
            </Button>
            <div className="font-mono text-[11px] text-fg-2">{step === 1 ? "admin" : step === 2 ? "workspace" : "complete"}</div>
            {step === 1 ? (
              <Button variant="primary" type="submit" form="setup-admin-form">
                Continue
              </Button>
            ) : step === 2 ? (
              <Button variant="primary" type="submit" form="setup-team-form" disabled={!teamName.trim()}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" type="button" onClick={handleSubmit} disabled={telemetryChoice === null || loading}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {loading ? "Setting up..." : "Complete setup"}
              </Button>
            )}
          </div>
        </main>
      </div>
    </div>
  );

  if (prefersReducedMotion) return wizard;

  return (
    <m.div initial={fadeInUp.initial as TargetAndTransition} animate={fadeInUp.animate as TargetAndTransition}>
      {wizard}
    </m.div>
  );
}

function AdminStep({ form, onSubmit }: { form: ReturnType<typeof useForm<SetupStep1Values>>; onSubmit: () => void }) {
  return (
    <Card className="border-line bg-bg-2 hover:translate-y-0 hover:shadow-none">
      <CardContent className="p-5">
        <SectionHeader title="Admin account" description="This user becomes the initial super admin for the instance." />
        <Form {...form}>
          <form id="setup-admin-form" onSubmit={form.handleSubmit(onSubmit)} className="mt-5 grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2">Name</FormLabel>
                  <FormControl>
                    <Input type="text" placeholder="Admin User" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2">Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="admin@example.com" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2">Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="At least 8 characters" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2">Confirm password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Re-enter your password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function TeamStep({ teamName, setTeamName, onSubmit }: { teamName: string; setTeamName: (value: string) => void; onSubmit: () => void }) {
  return (
    <Card className="border-line bg-bg-2 hover:translate-y-0 hover:shadow-none">
      <CardContent className="p-5">
        <SectionHeader title="Team setup" description="Teams contain environments, secrets, pipelines, roles, and audit scope." />
        <form id="setup-team-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className="mt-5 space-y-3">
          <Label htmlFor="teamName" className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2">Team name</Label>
          <Input id="teamName" type="text" placeholder="My Team" value={teamName} onChange={(event) => setTeamName(event.target.value)} required autoFocus />
          <p className="font-mono text-[11px] text-fg-2">Default environment and admin membership are created automatically.</p>
        </form>
      </CardContent>
    </Card>
  );
}

function TelemetryStep({ choice, setChoice }: { choice: "yes" | "no" | null; setChoice: (value: "yes" | "no") => void }) {
  return (
    <Card className="border-line bg-bg-2 hover:translate-y-0 hover:shadow-none">
      <CardContent className="p-5">
        <SectionHeader title="Telemetry" description="Anonymous, aggregate stats help prioritize self-hosted reliability work." />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            active={choice === "yes"}
            title="Share anonymous stats"
            description="Instance ID, version, agent count, and pipeline count once per day."
            onClick={() => setChoice("yes")}
          />
          <ChoiceCard
            active={choice === "no"}
            title="No thanks"
            description="Skip telemetry. You can enable it later from Settings."
            onClick={() => setChoice("no")}
          />
        </div>
        <p className="mt-4 font-mono text-[11px] text-fg-2">No pipeline data, user info, source names, sink endpoints, or secrets are sent.</p>
      </CardContent>
    </Card>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-2">setup</div>
      <h2 className="mt-1 font-mono text-[20px] font-medium text-fg">{title}</h2>
      <p className="mt-2 max-w-[620px] text-[12px] leading-relaxed text-fg-1">{description}</p>
    </div>
  );
}

function ChoiceCard({ active, title, description, onClick }: { active: boolean; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[3px] border p-4 text-left transition-colors",
        active ? "border-accent-brand bg-accent-soft" : "border-line bg-bg-1 hover:border-line-2 hover:bg-bg-3/50",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[13px] font-medium text-fg">{title}</div>
        <span className={cn("h-3 w-3 rounded-full border", active ? "border-accent-brand bg-accent-brand" : "border-line-2")} />
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-fg-1">{description}</p>
    </button>
  );
}
