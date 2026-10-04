import type { MirrorMessage } from "../mirror/types.js";
import type {
  Hcs10Event,
  Hcs10Op,
  Hcs10OperatorRef,
  Hcs10TopicKind,
  Hcs10TopicMemo,
} from "./types.js";

const entityId = /^\d+\.\d+\.\d+$/;
const knownOps = new Set<Hcs10Op>([
  "register",
  "connection_request",
  "connection_created",
  "message",
  "close_connection",
  "connection_closed",
]);
const topicKinds: Record<string, Hcs10TopicKind> = {
  "0": "inbound",
  "1": "outbound",
  "2": "connection",
  "3": "registry",
};

/**
 * Parses an HCS-10 topic memo. Returns `kind: "unknown"` for anything that is not an HCS-10 memo
 * instead of throwing, so callers can trace arbitrary topics and explain why nothing matched.
 */
export function parseHcs10TopicMemo(
  memo: string | null | undefined,
): Hcs10TopicMemo {
  const raw = (memo ?? "").trim();
  const empty: Hcs10TopicMemo = {
    raw,
    kind: "unknown",
    indexed: null,
    ttlSeconds: null,
    accountId: null,
    inboundTopicId: null,
    connectionId: null,
  };
  const parts = raw.split(":");
  if (parts[0] !== "hcs-10" || parts.length < 4) return empty;

  const [, indexedFlag, ttl, typeFlag, ...rest] = parts;
  const kind = topicKinds[typeFlag ?? ""] ?? "unknown";
  const ttlSeconds = Number(ttl);
  const result: Hcs10TopicMemo = {
    ...empty,
    kind,
    indexed: indexedFlag === "0" ? true : indexedFlag === "1" ? false : null,
    ttlSeconds:
      Number.isInteger(ttlSeconds) && ttlSeconds >= 0 ? ttlSeconds : null,
  };

  if (kind === "inbound" && rest[0] && entityId.test(rest[0])) {
    result.accountId = rest[0];
  }
  if (kind === "connection") {
    if (rest[0] && entityId.test(rest[0])) result.inboundTopicId = rest[0];
    const connectionId = Number(rest[1]);
    if (Number.isInteger(connectionId) && connectionId > 0)
      result.connectionId = connectionId;
  }
  return result;
}

/** Parses `{inboundTopicId}@{accountId}`. Returns null when the value is not in that shape. */
export function parseOperatorId(value: unknown): Hcs10OperatorRef | null {
  if (typeof value !== "string") return null;
  const [inboundTopicId, accountId, extra] = value.trim().split("@");
  if (extra !== undefined || !inboundTopicId || !accountId) return null;
  if (!entityId.test(inboundTopicId) || !entityId.test(accountId)) return null;
  return { raw: value.trim(), inboundTopicId, accountId };
}

/**
 * Turns raw mirror messages into HCS-10 events. Multi-chunk submissions are reassembled by their
 * initial transaction ID before JSON parsing. Messages that are not HCS-10 JSON are skipped.
 */
export function parseHcs10Events(messages: MirrorMessage[]): Hcs10Event[] {
  const events: Hcs10Event[] = [];
  const pending = new Map<string, MirrorMessage[]>();

  for (const message of [...messages].sort(
    (a, b) => a.sequence_number - b.sequence_number,
  )) {
    const total = message.chunk_info?.total ?? 1;
    if (total <= 1) {
      const event = toEvent([message]);
      if (event) events.push(event);
      continue;
    }

    const key = chunkKey(message);
    const group = pending.get(key) ?? [];
    group.push(message);
    pending.set(key, group);
    if (group.length === total) {
      pending.delete(key);
      const event = toEvent(
        group.sort(
          (a, b) => (a.chunk_info?.number ?? 0) - (b.chunk_info?.number ?? 0),
        ),
      );
      if (event) events.push(event);
    }
  }

  return events.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

/** Number of chunk groups that never completed in the given page (e.g. cut off by pagination). */
export function countIncompleteChunkGroups(messages: MirrorMessage[]): number {
  const groups = new Map<string, { total: number; seen: number }>();
  for (const message of messages) {
    const total = message.chunk_info?.total ?? 1;
    if (total <= 1) continue;
    const key = chunkKey(message);
    const group = groups.get(key) ?? { total, seen: 0 };
    group.seen += 1;
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.seen < group.total)
    .length;
}

function chunkKey(message: MirrorMessage): string {
  const initial = message.chunk_info?.initial_transaction_id;
  return `${initial?.account_id ?? message.payer_account_id}-${initial?.transaction_valid_start ?? message.consensus_timestamp}`;
}

function toEvent(chunks: MirrorMessage[]): Hcs10Event | null {
  const last = chunks[chunks.length - 1];
  if (!last) return null;

  const text = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.message, "base64")),
  ).toString("utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isRecord(json) ||
    json.p !== "hcs-10" ||
    typeof json.op !== "string" ||
    !knownOps.has(json.op as Hcs10Op)
  ) {
    return null;
  }

  const warnings: string[] = [];
  const operator = parseOperatorId(json.operator_id);
  if (json.operator_id !== undefined && !operator) {
    warnings.push(
      `operator_id "${String(json.operator_id)}" is not in {inboundTopicId}@{accountId} form.`,
    );
  }

  const rawData = json.data;
  let data: string | null = null;
  let dataRef: string | null = null;
  if (typeof rawData === "string") {
    if (rawData.startsWith("hcs://1/")) dataRef = rawData;
    else data = rawData;
  } else if (rawData !== undefined) {
    data = JSON.stringify(rawData);
  }

  const connectionId = toPositiveInt(json.connection_id);
  if (json.connection_id !== undefined && connectionId === null) {
    warnings.push(
      `connection_id "${String(json.connection_id)}" is not a positive integer.`,
    );
  }

  return {
    op: json.op as Hcs10Op,
    topicId: last.topic_id,
    sequenceNumber: chunks[0]!.sequence_number,
    consensusTimestamp: last.consensus_timestamp,
    payerAccountId: last.payer_account_id,
    operator,
    memo: typeof json.m === "string" ? json.m : null,
    connectionTopicId:
      typeof json.connection_topic_id === "string"
        ? json.connection_topic_id
        : null,
    connectionId,
    connectedAccountId:
      typeof json.connected_account_id === "string"
        ? json.connected_account_id
        : null,
    data,
    dataRef,
    chunkCount: chunks.length,
    raw: json,
    warnings,
  };
}

function toPositiveInt(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
