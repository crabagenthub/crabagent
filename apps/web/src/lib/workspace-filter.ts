"use client";

export const WORKSPACE_FILTER_STORAGE_KEY = "crabagent_workspace_name";
export const WORKSPACE_FILTER_EVENT = "crabagent-workspace-changed";

export type WorkspaceName = "OpenClaw" | "Hermes-Agent";

export const WORKSPACE_OPTIONS: { value: WorkspaceName; label: string }[] = [
  { value: "OpenClaw", label: "OpenClaw" },
  { value: "Hermes-Agent", label: "Hermes-Agent" },
];

export function normalizeWorkspaceName(raw: string | null | undefined): WorkspaceName {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return v === "hermes-agent" ? "Hermes-Agent" : "OpenClaw";
}

export function readWorkspaceName(): WorkspaceName {
  if (typeof window === "undefined") {
    return "OpenClaw";
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

