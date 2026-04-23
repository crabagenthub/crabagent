import { Suspense } from "react";
import { SecurityAuditDashboard } from "@/features/audit/content-audit/security-audit-dashboard";

export default function DataSecurityAuditPage() {
  return (
    <Suspense fallback={null}>
      <SecurityAuditDashboard />
    </Suspense>
  );
}
