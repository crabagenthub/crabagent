/**
 * 锚点 + 回合窗口 + buildConversationTimeline：保证每条用户轮次能拿到 llm_output 并渲染 assistant。
 * 运行：`pnpm --filter @crabagent/web test`
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TraceTimelineEvent } from "@/components/trace-timeline-tree";
import { buildConversationTurnWindowEvents, buildUserTurnList } from "./user-turn-list";
import { buildConversationTimeline } from "./trace-conversation-timeline";

function ev(
  partial: Pick<TraceTimelineEvent, "id" | "event_id" | "type"> & Partial<TraceTimelineEvent>,
): TraceTimelineEvent {
  return {
    client_ts: new Date(Number(partial.id ?? 0)).toISOString(),
    ...partial,
  } as TraceTimelineEvent;
}

describe("会话抽屉：turn.listKey 与 llm_output 链路", () => {
  it("两轮各含独立 trace 三联体时，每轮窗口含 :llm_out 且时间线有 assistant", () => {
    const events: TraceTimelineEvent[] = [
      ev({
        id: 1_700_000_000_100,
        event_id: "trace-a:recv",
        type: "message_received",
        trace_root_id: "trace-a",
        payload: { text: "u1" },
      }),
      ev({
        id: 1_700_000_000_101,
        event_id: "trace-a:llm_in",
        type: "llm_input",
        trace_root_id: "trace-a",
        payload: {},
      }),
      ev({
        id: 1_700_000_000_102,
        event_id: "trace-a:llm_out",
        type: "llm_output",
        trace_root_id: "trace-a",
        payload: { assistantTexts: ["reply-a"] },
      }),
      ev({
        id: 1_700_000_001_200,
        event_id: "trace-b:recv",
        type: "message_received",
        trace_root_id: "trace-b",
        payload: { text: "u2" },
      }),
      ev({
        id: 1_700_000_001_201,
        event_id: "trace-b:llm_in",
        type: "llm_input",
        trace_root_id: "trace-b",
      }),
      ev({
        id: 1_700_000_001_202,
        event_id: "trace-b:llm_out",
        type: "llm_output",
        trace_root_id: "trace-b",
        payload: { assistantTexts: ["reply-b"] },
      }),
    ];

    const turns = buildUserTurnList(events);
    assert.equal(turns.length, 2);
    for (const turn of turns) {
      const slice = buildConversationTurnWindowEvents(events, turn, turns);
      assert.ok(
        slice.some((e) => e.type === "llm_output"),
        `expected llm_output in window for ${turn.listKey}`,
      );
      const timeline = buildConversationTimeline(slice, turn);
      const assistants = timeline.filter((x) => x.kind === "assistant");
      assert.equal(assistants.length, 1, turn.listKey);
      assert.ok(
        assistants[0]!.kind === "assistant" && assistants[0]!.text.includes("reply-"),
        turn.listKey,
      );
    }
  });

  it("message_received.listKey 与 event_id 一致时锚点命中（与 queryThreadTraceEvents 一致）", () => {
    const tid = "ingest-xyz-9";
    const events: TraceTimelineEvent[] = [
      ev({
        id: 10,
        event_id: `${tid}:recv`,
        type: "message_received",
        trace_root_id: tid,
        payload: { text: "hi" },
      }),
      ev({
        id: 11,
        event_id: `${tid}:llm_in`,
        type: "llm_input",
        trace_root_id: tid,
      }),
      ev({
        id: 12,
        event_id: `${tid}:llm_out`,
        type: "llm_output",
        trace_root_id: tid,
        payload: { assistantTexts: ["yo"] },
      }),
    ];
    const turns = buildUserTurnList(events);
    assert.equal(turns[0]!.listKey, `${tid}:recv`);
    const slice = buildConversationTurnWindowEvents(events, turns[0]!, turns);
    assert.equal(slice.length, 3);
    assert.equal(slice[2]!.type, "llm_output");
  });
});
