"use client";

import { ExecutionTraceFlow } from "@/features/observe/traces/components/execution-trace-flow";

export type ConversationTraceFlowProps = {
  baseUrl: string;
  apiKey: string;
  threadId: string;
  maxNodes?: number;
  className?: string;
  onOpenTrace?: (traceId: string) => void;
};

/** Session-level execution graph: spans + trace headers, with parent and cross-trace edges. */
export function ConversationTraceFlow(props: ConversationTraceFlowProps) {
  return (
    <ExecutionTraceFlow
      variant="conversation"
      baseUrl={props.baseUrl}
      apiKey={props.apiKey}
      threadId={props.threadId}
      maxNodes={props.maxNodes ?? 500}
      className={props.className}
      onOpenTrace={props.onOpenTrace}
    />
  );
}
