"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
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

export default function SetupPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/setup")
      .then((res) => res.json())
      .then((data: { setupRequired: boolean }) => {
        if (!data.setupRequired) {
          router.replace("/login");
        } else {
          setReady(true);
        }
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  const form = useForm<SetupStep1Values>({
    resolver: zodResolver(setupStep1Schema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
    mode: "onBlur",
  });

  // Step 2 fields
  const [teamName, setTeamName] = useState("");

  function handleNext(data: SetupStep1Values) {
    // data is validated by zodResolver — no manual checks needed
    void data;
    setError(null);
    setStep(2);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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

  if (!ready) {
    return null;
  }

  return (
    <Card className="hover:translate-y-0 hover:shadow-none">
      <div className="flex items-center gap-2 px-6 pt-6">
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            step >= 1 ? "bg-primary" : "bg-muted-foreground/30"
          )}
        />
        <p className="text-xs text-muted-foreground">Admin Account</p>
        <div className="h-px flex-1 bg-border" />
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            step >= 2 ? "bg-primary" : "bg-muted-foreground/30"
          )}
        />
        <p className="text-xs text-muted-foreground">Team Setup</p>
      </div>

      <CardHeader>
        <CardTitle className="text-2xl">Welcome to VectorFlow</CardTitle>
        <CardDescription>
          {step === 1
            ? "Create your administrator account. You'll use these credentials to sign in and manage VectorFlow."
            : "Give your team a name. Teams contain environments and pipelines — you can create more teams later."}
        </CardDescription>
      </CardHeader>

      {step === 1 ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleNext)}>
            <CardContent className="flex flex-col gap-4">
              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Admin User"
                        autoFocus
                        {...field}
                      />
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
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="admin@example.com"
                        autoComplete="email"
                        {...field}
                      />
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
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                        {...field}
                      />
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
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Re-enter your password"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="pt-2">
              <Button type="submit" className="w-full">
                Continue to Team Setup
              </Button>
            </CardFooter>
          </form>
        </Form>
      ) : (
        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="teamName">Team name</Label>
              <Input
                id="teamName"
                type="text"
                placeholder="My Team"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                required
                autoFocus
              />
            </div>
          </CardContent>
          <CardFooter className="gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setStep(1)}
              disabled={loading}
            >
              Back
            </Button>
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Setting up...
                </>
              ) : (
                "Complete setup"
              )}
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}
