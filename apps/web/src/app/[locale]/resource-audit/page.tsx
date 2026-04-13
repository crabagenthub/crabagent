import { Suspense } from "react";
import { ResourceAuditDashboard } from "@/features/audit/resource-access/resource-audit-dashboard";

export default function ResourceAuditPage() {
  return (
    <Suspense fallback={null}>
      <ResourceAuditDashboard />
    </Suspense>
  );
}
