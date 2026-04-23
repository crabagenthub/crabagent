"use client";

import { cn } from "@/lib/utils";
import { parseAuditLinkForTelemetry, trackAuditLinkClick } from "@/lib/audit-link-telemetry";
import { LocalizedLink } from "@/shared/components/localized-link";

export type AuditLinkAction = {
  label: string;
  href: string;
};

export function AuditLinkActions({
  actions,
  vertical = false,
  className,
}: {
  actions: AuditLinkAction[];
  vertical?: boolean;
  className?: string;
}) {
  if (actions.length === 0) {
    return null;
  }
  return (
    <div className={cn("flex gap-2", vertical ? "flex-col items-start" : "flex-row items-center", className)}>
      {actions.map((item) => (
        <LocalizedLink
          key={`${item.label}:${item.href}`}
          href={item.href}
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => {
            const parsed = parseAuditLinkForTelemetry(item.href);
            trackAuditLinkClick({
              label: item.label,
              href: item.href,
              targetPath: parsed.targetPath,
              source: parsed.source,
              traceId: parsed.traceId,
              spanId: parsed.spanId,
              policyId: parsed.policyId,
            });
          }}
        >
          {item.label}
        </LocalizedLink>
      ))}
    </div>
  );
}

