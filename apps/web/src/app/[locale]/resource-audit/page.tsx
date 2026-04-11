import { Suspense } from "react";
import { ResourceAuditDashboard } from "@/components/resource-audit-dashboard";

export default function ResourceAuditPage() {
  return (
    <Suspense fallback={null}>
      <ResourceAuditDashboard />
    </Suspense>
  );
}
