import { describe, expect, it, vi } from "vitest";
import {
  Hcs10TraceError,
  buildConnectionFlow,
  compareTimestamps,
  countIncompleteChunkGroups,
  parseHcs10Events,
  parseHcs10TopicMemo,
  parseOperatorId,
  traceHcs10Topic,
} from "../src/hcs10/index.js";
import type { MirrorMessage } from "../src/mirror/types.js";
import {
  bobInboundMessages,
  bobInboundTopic,
  bobOutboundTopic,
  connectionMessages,
  connectionTopic,
  encode,
  mirrorMessage,
} from "./fixtures/hcs10-testnet.js";

const ALICE = "0.0.10854406@0.0.8009862";
const BOB = "0.0.10854409@0.0.8009862";

describe("HCS-10 topic memos", () => {
  it("parses inbound, outbound, and connection memos from the testnet demo", () => {
    expect(parseHcs10TopicMemo(bobInboundTopic.memo)).toMatchObject({
      kind: "inbound",
      indexed: true,
      ttlSeconds: 3600,
      accountId: "0.0.8009862",
    });
    expect(parseHcs10TopicMemo(bobOutboundTopic.memo)).toMatchObject({
      kind: "outbound",
      accountId: null,
    });
    expect(parseHcs10TopicMemo(connectionTopic.memo)).toMatchObject({
      kind: "connection",
      indexed: false,
      inboundTopicId: "0.0.10854409",
      connectionId: 1,
    });
  });

  it("returns unknown for non-HCS-10 or malformed memos instead of throwing", () => {
    expect(parseHcs10TopicMemo("hello").kind).toBe("unknown");
    expect(parseHcs10TopicMemo(undefined).kind).toBe("unknown");
    expect(parseHcs10TopicMemo("hcs-10:0").kind).toBe("unknown");
    expect(parseHcs10TopicMemo("hcs-10:1:60:2:not-a-topic:abc")).toMatchObject({
      kind: "connection",
      inboundTopicId: null,
      connectionId: null,
    });
  });
});

describe("HCS-10 operator IDs", () => {
  it("splits inbound topic and account", () => {
    expect(parseOperatorId(ALICE)).toEqual({
      raw: ALICE,
      inboundTopicId: "0.0.10854406",
      accountId: "0.0.8009862",
    });
  });

  it("rejects values that are not {topic}@{account}", () => {
    expect(parseOperatorId("0.0.1")).toBeNull();
    expect(parseOperatorId("0.0.1@")).toBeNull();
    expect(parseOperatorId("0.0.1@0.0.2@0.0.3")).toBeNull();
    expect(parseOperatorId("alice@0.0.2")).toBeNull();
    expect(parseOperatorId(42)).toBeNull();
  });
});

describe("HCS-10 event parsing", () => {
  it("parses the real inbound request and confirmation", () => {
    const [request, created] = parseHcs10Events(bobInboundMessages);
    expect(request).toMatchObject({
      op: "connection_request",
      sequenceNumber: 1,
      operator: { accountId: "0.0.8009862" },
    });
    expect(created).toMatchObject({
      op: "connection_created",
      connectionId: 1,
      connectionTopicId: "0.0.10854412",
      connectedAccountId: "0.0.8009862",
      operator: { raw: BOB },
    });
  });

  it("keeps message data as the string the sender submitted", () => {
    const [ping] = parseHcs10Events(connectionMessages);
    expect(ping?.op).toBe("message");
    expect(JSON.parse(ping!.data!)).toMatchObject({ type: "trace_lab_ping" });
    expect(ping?.dataRef).toBeNull();
  });

  it("skips non-HCS-10 payloads and flags malformed operator IDs", () => {
    const events = parseHcs10Events([
      mirrorMessage("0.0.9", 1, "plain text"),
      mirrorMessage("0.0.9", 2, { p: "hcs-2", op: "register" }),
      mirrorMessage("0.0.9", 3, {
        p: "hcs-10",
        op: "message",
        operator_id: "bob",
        data: "hi",
      }),
      mirrorMessage("0.0.9", 4, { p: "hcs-10", op: "not_an_op" }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.operator).toBeNull();
    expect(events[0]?.warnings[0]).toContain("operator_id");
  });

  it("detects HCS-1 references instead of treating them as inline data", () => {
    const [event] = parseHcs10Events([
      mirrorMessage("0.0.9", 1, {
        p: "hcs-10",
        op: "message",
        operator_id: ALICE,
        data: "hcs://1/0.0.777",
      }),
    ]);
    expect(event?.dataRef).toBe("hcs://1/0.0.777");
    expect(event?.data).toBeNull();
  });

  it("reassembles chunked submissions and reports incomplete groups", () => {
    const encoded = Buffer.from(
      encode({
        p: "hcs-10",
        op: "message",
        operator_id: ALICE,
        data: "x".repeat(40),
      }),
      "base64",
    );
    const half = Math.ceil(encoded.length / 2);
    const initial = {
      account_id: "0.0.1001",
      transaction_valid_start: "1791200000.000000001",
    };
    const chunks: MirrorMessage[] = [
      encoded.subarray(0, half),
      encoded.subarray(half),
    ].map((part, index) => ({
      chunk_info: {
        initial_transaction_id: initial,
        number: index + 1,
        total: 2,
      },
      consensus_timestamp: `1791200001.00000000${index}`,
      message: part.toString("base64"),
      payer_account_id: "0.0.1001",
      sequence_number: 10 + index,
      topic_id: "0.0.9",
    }));

    const events = parseHcs10Events([chunks[1]!, chunks[0]!]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sequenceNumber: 10,
      chunkCount: 2,
      data: "x".repeat(40),
    });

    expect(parseHcs10Events([chunks[0]!])).toHaveLength(0);
    expect(countIncompleteChunkGroups([chunks[0]!])).toBe(1);
  });
});

describe("HCS-10 connection flows", () => {
  const inboundEvents = parseHcs10Events(bobInboundMessages);
  const connectionEvents = parseHcs10Events(connectionMessages);
  const baseInput = {
    network: "testnet" as const,
    inboundTopicId: "0.0.10854409",
    connectionId: 1,
    inboundEvents,
    connectionTopicId: "0.0.10854412",
    connectionTopicMemo: parseHcs10TopicMemo(connectionTopic.memo),
    connectionEvents,
  };

  it("rebuilds the real demo exchange as one active flow", () => {
    const flow = buildConnectionFlow(baseInput);
    expect(flow.status).toBe("active");
    expect(
      flow.participants.map((participant) => [
        participant.role,
        participant.operator.raw,
      ]),
    ).toEqual([
      ["requester", ALICE],
      ["responder", BOB],
    ]);
    expect(flow.messages).toHaveLength(2);
    expect(
      flow.checks.filter(
        (check) => check.status === "fail" || check.status === "warn",
      ),
    ).toEqual([]);
    expect(
      flow.checks.find((check) => check.id === "shared_account")?.status,
    ).toBe("info");
    expect(flow.links.connectionTopic).toBe(
      "https://hashscan.io/testnet/topic/0.0.10854412",
    );
  });

  it("fails when the confirmation points at a different connection topic", () => {
    const flow = buildConnectionFlow({
      ...baseInput,
      connectionTopicId: "0.0.999",
    });
    expect(
      flow.checks.find((check) => check.id === "confirmation_topic")?.status,
    ).toBe("fail");
  });

  it("fails when the connection memo does not link back to the request", () => {
    const flow = buildConnectionFlow({
      ...baseInput,
      connectionTopicMemo: parseHcs10TopicMemo(
        "hcs-10:1:3600:2:0.0.10854409:7",
      ),
    });
    expect(flow.checks.find((check) => check.id === "memo_kind")?.status).toBe(
      "fail",
    );
  });

  it("warns about messages from operators outside the connection", () => {
    const stranger = parseHcs10Events([
      mirrorMessage(
        "0.0.10854412",
        3,
        { p: "hcs-10", op: "message", operator_id: "0.0.5@0.0.6", data: "hi" },
        {
          consensus_timestamp: "1791101500.000000000",
        },
      ),
    ]);
    const flow = buildConnectionFlow({
      ...baseInput,
      connectionEvents: [...connectionEvents, ...stranger],
    });
    const check = flow.checks.find((item) => item.id === "message_senders");
    expect(check?.status).toBe("warn");
    expect(check?.detail).toContain("0.0.5@0.0.6");
  });

  it("reports a pending request when no confirmation exists", () => {
    const flow = buildConnectionFlow({
      network: "testnet",
      inboundTopicId: "0.0.10854409",
      connectionId: 1,
      inboundEvents: inboundEvents.filter(
        (event) => event.op === "connection_request",
      ),
    });
    expect(flow.status).toBe("requested");
    expect(flow.connectionTopicId).toBeNull();
    expect(
      flow.checks.find((check) => check.id === "confirmation_found")?.status,
    ).toBe("warn");
  });

  it("fails when the request is missing from the inbound topic", () => {
    const flow = buildConnectionFlow({ ...baseInput, inboundEvents: [] });
    expect(flow.status).toBe("incomplete");
    expect(
      flow.checks.find((check) => check.id === "request_found")?.status,
    ).toBe("fail");
  });

  it("marks a flow closed when a close_connection appears", () => {
    const close = parseHcs10Events([
      mirrorMessage(
        "0.0.10854412",
        3,
        { p: "hcs-10", op: "close_connection", operator_id: BOB },
        {
          consensus_timestamp: "1791101500.000000000",
        },
      ),
    ]);
    expect(
      buildConnectionFlow({
        ...baseInput,
        connectionEvents: [...connectionEvents, ...close],
      }).status,
    ).toBe("closed");
  });

  it("compares consensus timestamps at nanosecond precision", () => {
    expect(
      compareTimestamps("1791101498.341522104", "1791101498.341522103"),
    ).toBe(1);
    expect(compareTimestamps("1791101498.1", "1791101498.100000000")).toBe(0);
    expect(compareTimestamps("1791101497.999999999", "1791101498.0")).toBe(-1);
  });
});

describe("traceHcs10Topic", () => {
  function mirrorStub(
    pages: Record<string, MirrorMessage[]>,
    topics: Record<string, unknown>,
  ) {
    return vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const match = url.pathname.match(
        /^\/api\/v1\/topics\/([\d.]+)(\/messages)?$/,
      );
      const topicId = match?.[1] ?? "";
      if (!match) return new Response("{}", { status: 404 });
      if (!match[2]) {
        return topics[topicId]
          ? Response.json(topics[topicId])
          : new Response("{}", { status: 404 });
      }
      const limit = Number(url.searchParams.get("limit") ?? 25);
      const after = Number(
        (url.searchParams.get("sequencenumber") ?? "gt:0").replace("gt:", ""),
      );
      const all = (pages[topicId] ?? []).filter(
        (message) => message.sequence_number > after,
      );
      const page = all.slice(0, limit);
      const last = page[page.length - 1];
      const next =
        all.length > limit && last
          ? `/api/v1/topics/${topicId}/messages?limit=${limit}&order=asc&sequencenumber=gt:${last.sequence_number}`
          : null;
      return Response.json({ messages: page, links: { next } });
    });
  }

  const topics = {
    "0.0.10854409": bobInboundTopic,
    "0.0.10854410": bobOutboundTopic,
    "0.0.10854412": connectionTopic,
  };
  const pages = {
    "0.0.10854409": bobInboundMessages,
    "0.0.10854412": connectionMessages,
  };

  it("traces from a connection topic back to its inbound request", async () => {
    const fetchImpl = mirrorStub(pages, topics);
    const trace = await traceHcs10Topic({
      network: "testnet",
      topicId: "0.0.10854412",
      fetchImpl,
    });
    expect(trace.entry).toBe("connection");
    expect(trace.flows).toHaveLength(1);
    expect(trace.flows[0]).toMatchObject({
      status: "active",
      inboundTopicId: "0.0.10854409",
      connectionId: 1,
    });
    expect(
      fetchImpl.mock.calls.some(([url]) =>
        String(url).includes("/topics/0.0.10854409/messages"),
      ),
    ).toBe(true);
  });

  it("traces from an inbound topic forward to each connection topic", async () => {
    const trace = await traceHcs10Topic({
      network: "testnet",
      topicId: "10854409",
      fetchImpl: mirrorStub(pages, topics),
    });
    expect(trace.entry).toBe("inbound");
    expect(trace.topicId).toBe("0.0.10854409");
    expect(trace.flows[0]).toMatchObject({
      status: "active",
      connectionTopicId: "0.0.10854412",
    });
    expect(trace.flows[0]?.messages).toHaveLength(2);
  });

  it("explains why an outbound topic cannot start a trace", async () => {
    await expect(
      traceHcs10Topic({
        network: "testnet",
        topicId: "0.0.10854410",
        fetchImpl: mirrorStub(pages, topics),
      }),
    ).rejects.toBeInstanceOf(Hcs10TraceError);
  });

  it("bounds pagination and reports truncation", async () => {
    const many = Array.from({ length: 250 }, (_, index) =>
      mirrorMessage(
        "0.0.10854412",
        index + 1,
        { p: "hcs-10", op: "message", operator_id: ALICE, data: `m${index}` },
        {
          consensus_timestamp: `1791101500.${String(index).padStart(9, "0")}`,
        },
      ),
    );
    const trace = await traceHcs10Topic({
      network: "testnet",
      topicId: "0.0.10854412",
      maxMessagesPerTopic: 150,
      fetchImpl: mirrorStub({ ...pages, "0.0.10854412": many }, topics),
    });
    expect(trace.truncated).toBe(true);
    expect(trace.flows[0]?.messages).toHaveLength(200);
    expect(
      trace.warnings.some((warning) => warning.includes("0.0.10854412")),
    ).toBe(true);
  });
});
