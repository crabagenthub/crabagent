import { Suspense } from "react";
import { EventsDashboard } from "@/features/audit/events/events-dashboard";

export default function EventsPage() {
  return (
    <Suspense fallback={null}>
      <EventsDashboard />
    </Suspense>
  );
}

