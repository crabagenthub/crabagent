import { Suspense } from "react";
import { CommandAnalysisDashboard } from "@/components/command-analysis-dashboard";

export default function CommandAnalysisPage() {
  return (
    <Suspense fallback={null}>
      <CommandAnalysisDashboard />
    </Suspense>
  );
}
