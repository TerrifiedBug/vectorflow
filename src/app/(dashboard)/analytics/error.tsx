'use client';
import { ErrorState } from '@/components/ui/error-state';
export default function SectionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState error={error} reset={reset} />;
}
