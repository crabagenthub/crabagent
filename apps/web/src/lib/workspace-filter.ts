"use client";

export const WORKSPACE_FILTER_STORAGE_KEY = "crabagent_workspace_name";
export const WORKSPACE_FILTER_EVENT = "crabagent-workspace-changed";

export type WorkspaceName = "openclaw" | "hermes-agent";

export const WORKSPACE_OPTIONS: { value: WorkspaceName; label: string }[] = [
  { value: "openclaw", label: "OpenClaw" },
  { value: "hermes-agent", label: "Hermes-Agent" },
];

export function normalizeWorkspaceName(raw: string | null | undefined): WorkspaceName {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return v === "hermes-agent" ? "hermes-agent" : "openclaw";
}

export function readWorkspaceName(): WorkspaceName {
  if (typeof window === "undefined") {
    return "openclaw";
  }
  return normalizeWorkspaceName(window.localStorage.getItem(WORKSPACE_FILTER_STORAGE_KEY));
}

export function saveWorkspaceName(next: WorkspaceName): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(WORKSPACE_FILTER_STORAGE_KEY, next);
  window.dispatchEvent(new Event(WORKSPACE_FILTER_EVENT));
}

