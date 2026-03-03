export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl tracking-tight">
            <span className="font-bold">Vector</span>
            <span className="font-light">Flow</span>
          </h1>
          <p className="text-sm text-muted-foreground">Visual pipeline builder for Vector</p>
        </div>
        {children}
      </div>
    </div>
  );
}
