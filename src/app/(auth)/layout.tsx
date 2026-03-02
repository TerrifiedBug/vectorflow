import { Workflow } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <Workflow className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-semibold">VectorFlow</h1>
          <p className="text-sm text-muted-foreground">Visual pipeline builder for Vector</p>
        </div>
        {children}
      </div>
    </div>
  );
}
