"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ExternalLink } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";

export function UpdateBanner() {
  const trpc = useTRPC();
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery(
    trpc.settings.checkVersion.queryOptions(undefined, {
      refetchInterval: false,
      staleTime: Infinity,
    }),
  );

  if (dismissed || !data?.server.updateAvailable) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm dark:border-blue-800 dark:bg-blue-950">
      <p className="flex-1">
        VectorFlow{" "}
        <span className="font-semibold">{data.server.latestVersion}</span> is
        available. You&apos;re running{" "}
        <span className="font-semibold">{data.server.currentVersion}</span>.
        {data.server.releaseUrl && (
          <>
            {" "}
            <a
              href={data.server.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
            >
              Release notes
              <ExternalLink className="h-3 w-3" />
            </a>
          </>
        )}
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-blue-700 hover:bg-blue-100 hover:text-blue-900 dark:text-blue-300 dark:hover:bg-blue-900 dark:hover:text-blue-100"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update notification"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
