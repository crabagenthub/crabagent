import { Suspense } from "react";
import { RiskOverviewDashboard } from "@/features/audit/risk-overview/risk-overview-dashboard";

export default function RiskOverviewPage() {
  return (
    <Suspense fallback={null}>
      <RiskOverviewDashboard />
    </Suspense>
  );
}
