'use client';

import { AlertTriangle } from 'lucide-react';
import { FadeIn } from '@/components/motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export function ErrorState({ error, reset }: ErrorStateProps) {
  return (
    <div className="flex min-h-[400px] items-center justify-center p-8">
      <FadeIn className="w-full max-w-md">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <div>
              <h2 className="text-lg font-semibold">Something went wrong</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                An unexpected error occurred. Try again or refresh the page.
              </p>
            </div>
            {error.digest && (
              <p className="text-xs text-muted-foreground">
                Error ID: <code className="font-mono">{error.digest}</code>
              </p>
            )}
            <Button variant="outline" onClick={reset}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </FadeIn>
    </div>
  );
}
