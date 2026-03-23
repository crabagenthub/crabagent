/**
 * Verifies detail slicing includes the full pipeline for a clicked message.
 * Run from repo: pnpm verify:detail-chain
 */
import type { TraceTimelineEvent } from "@/components/trace-timeline-tree";
import { buildDetailEventList, buildUserTurnList } from "./user-turn-list";
import { pipelineCoverageFromEvents } from "./trace-detail-pipeline";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(msg);
  }
}

function ev(
  partial: Pick<TraceTimelineEvent, "id" | "event_id" | "type"> &
    Partial<TraceTimelineEvent>,
): TraceTimelineEvent {
  return { ...partial } as TraceTimelineEvent;
}

const TR = "trace-root-verify-aaa";
const SK = "agent:main:verify:user-1";
const SID = "sess-verify-1";
const RUN = "run-verify-bbb";

/** message_received 无 trace_root，后续钩子带同一 root（与线上插件一致） */
const scenarioNoRootOnMessage: TraceTimelineEvent[] = [
  ev({
    id: 10,
    event_id: "msg-1",
    type: "message_received",
    session_id: SID,
    session_key: SK,
    payload: { content: "hello pipeline", channel: "verify" },
  }),
  ev({
    id: 11,
    event_id: "h1",
    type: "before_model_resolve",
    session_id: SID,
    session_key: SK,
    trace_root_id: TR,
    payload: { promptCharCount: 5 },
  }),
  ev({
    id: 12,
    event_id: "h2",
    type: "before_prompt_build",
    session_id: SID,
    session_key: SK,
    trace_root_id: TR,
    payload: { historyMessageCount: 1 },
  }),
  ev({
    id: 13,
    event_id: "h3",
    type: "hook_contribution",
    session_id: SID,
    session_key: SK,
    trace_root_id: TR,
    run_id: RUN,
    payload: { sourceHook: "prepend", contributingPluginId: "memory" },
  }),
  ev({
    id: 14,
    event_id: "li",
    type: "llm_input",
    session_id: SID,
    session_key: SK,
    trace_root_id: TR,
    run_id: RUN,
    payload: { provider: "openai", model: "gpt", prompt: "hello" },
  }),
  ev({
    id: 15,
    event_id: "lo",
    type: "llm_output",
    session_id: SID,
    session_key: SK,
    trace_root_id: TR,
    run_id: RUN,
    payload: { assistantTexts: ["hi"] },
  }),
];

function runScenario(name: string, events: TraceTimelineEvent[]): void {
  const turns = buildUserTurnList(events);
  assert(turns.length >= 1, `${name}: expected at least one turn`);
  const slice = buildDetailEventList(events, turns[0]!);
  const types = new Set(slice.map((e) => e.type));

  for (const req of [
    "message_received",
    "before_model_resolve",
    "before_prompt_build",
    "hook_contribution",
    "llm_input",
    "llm_output",
  ] as const) {
    assert(types.has(req), `${name}: slice missing type "${req}" (got ${[...types].join(", ")})`);
  }
  assert(slice.length === 6, `${name}: expected 6 events, got ${slice.length}`);

  const cov = pipelineCoverageFromEvents(slice);
  assert(cov.orderedTypes.includes("llm_input"), `${name}: coverage`);
}

function main(): void {
  runScenario("no_trace_on_message", scenarioNoRootOnMessage);

  const withRootOnMessage = scenarioNoRootOnMessage.map((e) =>
    e.event_id === "msg-1" ? { ...e, trace_root_id: TR } : e,
  ) as TraceTimelineEvent[];
  runScenario("trace_on_message", withRootOnMessage);

  // Second user message in thread: slice for first message must not include second pipeline
  const twoTurns: TraceTimelineEvent[] = [
    ...scenarioNoRootOnMessage,
    ev({
      id: 20,
      event_id: "msg-2",
      type: "message_received",
      session_id: SID,
      session_key: SK,
      payload: { content: "second", channel: "verify" },
    }),
    ev({
      id: 21,
      event_id: "h2-1",
      type: "before_model_resolve",
      session_id: SID,
      session_key: SK,
      trace_root_id: "trace-root-other",
      payload: { promptCharCount: 1 },
    }),
  ];
  const turns2 = buildUserTurnList(twoTurns);
  assert(turns2.length === 2, "two_turns: list");
  const sliceFirst = buildDetailEventList(twoTurns, turns2[0]!);
  assert(
    !sliceFirst.some((e) => e.trace_root_id === "trace-root-other"),
    "two_turns: first slice must not include second trace_root",
  );
  assert(sliceFirst.length === 6, "two_turns: first slice size");

  globalThis.console.log(
    "detail-chain.verify: OK (scenarios: no root on msg, root on msg, two turns isolation)",
  );
}

main();
