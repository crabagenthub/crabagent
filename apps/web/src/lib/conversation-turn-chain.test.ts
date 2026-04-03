/**
 * 锚点 + 回合窗口 + buildConversationTimeline：保证每条用户轮次能拿到 llm_output 并渲染 assistant。
 * 运行：`pnpm --filter @crabagent/web test`
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TraceTimelineEvent } from "@/components/trace-timeline-tree";
import {
  buildConversationTurnWindowEvents,
  buildTranscriptEventList,
  buildUserTurnList,
} from "./user-turn-list";
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

  it("llm_output 无 assistantTexts 但 payload.messages 含 role=tool 时仍能渲染助手正文（OpenClaw Tool 首条）", () => {
    const tid = "trace-tool-role";
    const events: TraceTimelineEvent[] = [
      ev({
        id: 20,
        event_id: `${tid}:recv`,
        type: "message_received",
        trace_root_id: tid,
        payload: { text: "问" },
      }),
      ev({
        id: 21,
        event_id: `${tid}:llm_in`,
        type: "llm_input",
        trace_root_id: tid,
        payload: {},
      }),
      ev({
        id: 22,
        event_id: `${tid}:llm_out`,
        type: "llm_output",
        trace_root_id: tid,
        payload: {
          messages: [
            { role: "user", content: "问" },
            { role: "tool", content: "你好！我是助手。" },
          ],
        },
      }),
    ];
    const turns = buildUserTurnList(events);
    const slice = buildConversationTurnWindowEvents(events, turns[0]!, turns);
    const timeline = buildConversationTimeline(slice, turns[0]!);
    const assistants = timeline.filter((x) => x.kind === "assistant");
    assert.equal(assistants.length, 1);
    assert.equal(
      assistants[0]!.kind === "assistant" ? assistants[0]!.text : "",
      "你好！我是助手。",
    );
  });

  it("buildTranscriptEventList：同 msg_id 的 llm_output 排在用户锚点之前时仍并入会话正文", () => {
    const sharedMsg = "msg-shared-union";
    const events: TraceTimelineEvent[] = [
      ev({
        id: 50,
        event_id: "orphan-llm:out",
        type: "llm_output",
        trace_root_id: "trace-x",
        msg_id: sharedMsg,
        payload: { assistantTexts: ["需要批准天气查询（前置）"] },
      }),
      ev({
        id: 100,
        event_id: "trace-1:recv",
        type: "message_received",
        trace_root_id: "trace-1",
        msg_id: sharedMsg,
        payload: { text: "user turn" },
      }),
      ev({
        id: 101,
        event_id: "trace-1:llm_in",
        type: "llm_input",
        trace_root_id: "trace-1",
        msg_id: sharedMsg,
      }),
      ev({
        id: 102,
        event_id: "trace-1:llm_out",
        type: "llm_output",
        trace_root_id: "trace-1",
        msg_id: sharedMsg,
        payload: { assistantTexts: ["后置回复"] },
      }),
    ];
    const turns = buildUserTurnList(events);
    assert.equal(turns.length, 1);
    const turn = turns[0]!;
    const windowOnly = buildConversationTurnWindowEvents(events, turn, turns);
    const unioned = buildTranscriptEventList(events, turn, turns);
    assert.equal(
      windowOnly.some((e) => e.event_id === "orphan-llm:out"),
      false,
      "pure window drops pre-anchor llm_output",
    );
    assert.equal(
      unioned.some((e) => e.event_id === "orphan-llm:out"),
      true,
      "transcript union keeps same-msg_id llm_output",
    );
    const timeline = buildConversationTimeline(unioned, turn, { messagesOnly: true });
    const assistants = timeline.filter((x) => x.kind === "assistant");
    assert.equal(assistants.length, 2);
    assert.ok(
      assistants.some((a) => a.kind === "assistant" && a.text.includes("需要批准天气")),
    );
  });
});
