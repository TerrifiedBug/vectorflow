"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PipelineScorecard } from "@/components/pipeline/pipeline-scorecard";

export default function PipelineScorecardPage() {
  const params = useParams<{ id: string }>();

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Scorecard</h2>
          <p className="text-muted-foreground">
            Health, alerts, anomalies, cost, and trends at a glance.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/pipelines/${params.id}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to editor
          </Link>
        </Button>
      </div>

      <PipelineScorecard pipelineId={params.id} />
    </div>
  );
}
