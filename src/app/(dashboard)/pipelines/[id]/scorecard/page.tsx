"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PipelineScorecard } from "@/components/pipeline/pipeline-scorecard";

export default function PipelineScorecardPage() {
  const params = useParams<{ id: string }>();

  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Pipeline scorecard"
        subtitle="Health, alerts, anomalies, cost, and trend signals in the v2 operational surface."
        breadcrumb={<span>pipelines / scorecard</span>}
        actions={
          <Button asChild variant="outline" size="sm" className="font-mono text-[11px] uppercase tracking-[0.04em]">
            <Link href={`/pipelines/${params.id}`}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Pipeline detail
            </Link>
          </Button>
        }
      />
      <div className="p-4">

      <PipelineScorecard pipelineId={params.id} />
      </div>
    </div>
  );
}
