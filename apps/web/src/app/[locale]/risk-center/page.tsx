import { Suspense } from "react";
import { RiskCenterDashboard } from "@/features/audit/risk-center/risk-center-dashboard";

export default function RiskCenterPage() {
  return (
    <Suspense fallback={null}>
      <RiskCenterDashboard />
    </Suspense>
  );
}

