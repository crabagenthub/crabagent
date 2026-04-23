import { Suspense } from "react";
import { InvestigationCenterDashboard } from "@/features/audit/investigation/investigation-center-dashboard";

export default function InvestigationCenterPage() {
  return (
    <Suspense fallback={null}>
      <InvestigationCenterDashboard />
    </Suspense>
  );
}

