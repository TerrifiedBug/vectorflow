"use client";

import dynamic from "next/dynamic";

const PipelineEditorClient = dynamic(() => import("./editor-client"), {
  ssr: false,
});

export default PipelineEditorClient;
