import {
  fetchMessagePage,
  fetchTopicSnapshot,
  normalizeTopicId,
} from "../mirror/index.js";
import type { HederaNetwork, MirrorMessage } from "../mirror/types.js";
import { buildConnectionFlow } from "./flow.js";
import {
  countIncompleteChunkGroups,
  parseHcs10Events,
  parseHcs10TopicMemo,
} from "./parse.js";
import type {
  Hcs10ConnectionFlow,
  Hcs10Event,
  Hcs10TopicMemo,
  Hcs10Trace,
} from "./types.js";

export interface TraceOptions {
  network: HederaNetwork;
  topicId: string;
  /** Upper bound on messages read per topic. Defaults to 500. */
  maxMessagesPerTopic?: number;
  /** Upper bound on connections expanded when tracing from an inbound topic. Defaults to 5. */
  maxFlows?: number;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export class Hcs10TraceError extends Error {
  constructor(
    message: string,
    readonly memo: Hcs10TopicMemo,
  ) {
    super(message);
    this.name = "Hcs10TraceError";
  }
}

const pageSize = 100;

/**
 * Traces HCS-10 connections starting from either:
 * - a connection topic: follows its memo back to the inbound topic and rebuilds that one connection, or
 * - an inbound topic: lists connection requests and expands up to `maxFlows` of them.
 *
 * Read-only. Uses only public mirror node endpoints.
 */
export async function traceHcs10Topic(
  options: TraceOptions,
): Promise<Hcs10Trace> {
  const topicId = normalizeTopicId(options.topicId);
  const ctx = toContext(options);
  const memo = await readTopicMemo(ctx, topicId);

  if (memo.kind === "connection")
    return traceFromConnectionTopic(ctx, topicId, memo);
  if (memo.kind === "inbound") return traceFromInboundTopic(ctx, topicId, memo);

  throw new Hcs10TraceError(
    memo.raw
      ? `Topic ${topicId} has memo "${memo.raw}", which is not an HCS-10 inbound or connection topic. Start a trace from an agent's inbound topic or from a connection topic.`
      : `Topic ${topicId} has no HCS-10 memo. Start a trace from an agent's inbound topic or from a connection topic.`,
    memo,
  );
}

interface Context {
  network: HederaNetwork;
  maxMessages: number;
  maxFlows: number;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

function toContext(options: TraceOptions): Context {
  return {
    network: options.network,
    maxMessages: clamp(options.maxMessagesPerTopic ?? 500, 1, 2000),
    maxFlows: clamp(options.maxFlows ?? 5, 1, 25),
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    fetchImpl: options.fetchImpl,
  };
}

async function traceFromConnectionTopic(
  ctx: Context,
  topicId: string,
  memo: Hcs10TopicMemo,
): Promise<Hcs10Trace> {
  const warnings: string[] = [];
  if (!memo.inboundTopicId || !memo.connectionId) {
    throw new Hcs10TraceError(
      `Connection topic ${topicId} memo "${memo.raw}" does not name its inbound topic and connection ID, so the request cannot be located.`,
      memo,
    );
  }

  const [inbound, connection] = await Promise.all([
    readEvents(ctx, memo.inboundTopicId),
    readEvents(ctx, topicId),
  ]);
  warnings.push(...inbound.warnings, ...connection.warnings);

  const flow = buildConnectionFlow({
    network: ctx.network,
    inboundTopicId: memo.inboundTopicId,
    connectionId: memo.connectionId,
    inboundEvents: inbound.events,
    connectionTopicId: topicId,
    connectionTopicMemo: memo,
    connectionEvents: connection.events,
  });

  return finish(
    ctx,
    topicId,
    memo,
    "connection",
    [flow],
    inbound.truncated || connection.truncated,
    warnings,
  );
}

async function traceFromInboundTopic(
  ctx: Context,
  topicId: string,
  memo: Hcs10TopicMemo,
): Promise<Hcs10Trace> {
  const inbound = await readEvents(ctx, topicId);
  const warnings = [...inbound.warnings];
  const requests = inbound.events.filter(
    (event) => event.op === "connection_request",
  );
  const selected = requests.slice(-ctx.maxFlows).reverse();
  let truncated = inbound.truncated;
  if (requests.length > selected.length) {
    truncated = true;
    warnings.push(
      `Showing the latest ${selected.length} of ${requests.length} connection requests.`,
    );
  }

  const flows: Hcs10ConnectionFlow[] = [];
  for (const request of selected) {
    const draft = buildConnectionFlow({
      network: ctx.network,
      inboundTopicId: topicId,
      connectionId: request.sequenceNumber,
      inboundEvents: inbound.events,
    });
    if (!draft.connectionTopicId) {
      flows.push(draft);
      continue;
    }

    try {
      const [connectionMemo, connection] = await Promise.all([
        readTopicMemo(ctx, draft.connectionTopicId),
        readEvents(ctx, draft.connectionTopicId),
      ]);
      truncated ||= connection.truncated;
      warnings.push(...connection.warnings);
      flows.push(
        buildConnectionFlow({
          network: ctx.network,
          inboundTopicId: topicId,
          connectionId: request.sequenceNumber,
          inboundEvents: inbound.events,
          connectionTopicId: draft.connectionTopicId,
          connectionTopicMemo: connectionMemo,
          connectionEvents: connection.events,
        }),
      );
    } catch (error) {
      warnings.push(
        `Could not read connection topic ${draft.connectionTopicId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      flows.push(draft);
    }
  }

  return finish(ctx, topicId, memo, "inbound", flows, truncated, warnings);
}

async function readTopicMemo(
  ctx: Context,
  topicId: string,
): Promise<Hcs10TopicMemo> {
  const snapshot = await fetchTopicSnapshot({
    network: ctx.network,
    topicId,
    limit: 1,
    timeoutMs: ctx.timeoutMs,
    maxRetries: ctx.maxRetries,
    fetchImpl: ctx.fetchImpl,
  });
  return parseHcs10TopicMemo(snapshot.topic.memo);
}

async function readEvents(
  ctx: Context,
  topicId: string,
): Promise<{ events: Hcs10Event[]; truncated: boolean; warnings: string[] }> {
  const messages: MirrorMessage[] = [];
  let cursor: string | null = null;
  let truncated = false;

  do {
    const page = await fetchMessagePage({
      network: ctx.network,
      topicId,
      limit: pageSize,
      order: "asc",
      cursor,
      timeoutMs: ctx.timeoutMs,
      maxRetries: ctx.maxRetries,
      fetchImpl: ctx.fetchImpl,
    });
    messages.push(...page.messages);
    cursor = page.nextCursor;
    if (cursor && messages.length >= ctx.maxMessages) {
      truncated = true;
      break;
    }
  } while (cursor);

  const warnings: string[] = [];
  if (truncated)
    warnings.push(
      `Read the first ${messages.length} messages of ${topicId}; later messages were not traced.`,
    );
  const incomplete = countIncompleteChunkGroups(messages);
  if (incomplete > 0)
    warnings.push(
      `${incomplete} chunked message(s) on ${topicId} were incomplete and skipped.`,
    );

  return { events: parseHcs10Events(messages), truncated, warnings };
}

function finish(
  ctx: Context,
  topicId: string,
  memo: Hcs10TopicMemo,
  entry: Hcs10Trace["entry"],
  flows: Hcs10ConnectionFlow[],
  truncated: boolean,
  warnings: string[],
): Hcs10Trace {
  return {
    network: ctx.network,
    topicId,
    topicMemo: memo,
    entry,
    flows,
    truncated,
    warnings: [...new Set(warnings)],
    fetchedAt: new Date().toISOString(),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
