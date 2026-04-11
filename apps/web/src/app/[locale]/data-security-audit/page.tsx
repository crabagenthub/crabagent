import { Suspense } from "react";
import { SecurityAuditDashboard } from "@/components/security-audit-dashboard";

export default function DataSecurityAuditPage() {
  return (
    <Suspense fallback={null}>
      <SecurityAuditDashboard />
    </Suspense>
  );
}
