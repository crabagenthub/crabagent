import { Suspense } from "react";
import { CommandAnalysisDashboard } from "@/features/audit/command-exec/command-analysis-dashboard";

export default function CommandAnalysisPage() {
  return (
    <Suspense fallback={null}>
      <CommandAnalysisDashboard />
    </Suspense>
  );
}
