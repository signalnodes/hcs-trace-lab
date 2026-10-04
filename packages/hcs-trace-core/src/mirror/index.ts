import { decodePayload } from "../decode/index.js";
import type {
  EnrichedMessage,
  HederaNetwork,
  MirrorMessage,
  MirrorTopicInfo,
  SortOrder,
  TopicSnapshot,
  TopicSnapshotOptions,
} from "./types.js";

export * from "./types.js";

const mirrorBases: Record<HederaNetwork, string> = {
  mainnet: "https://mainnet.mirrornode.hedera.com",
  testnet: "https://testnet.mirrornode.hedera.com",
  previewnet: "https://previewnet.mirrornode.hedera.com",
};

const maxPageLimit = 100;
const defaultTimeoutMs = 10_000;
const defaultMaxRetries = 2;

export function getMirrorBase(network: HederaNetwork): string {
  return mirrorBases[network];
}

export function normalizeTopicId(input: string): string {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return `0.0.${trimmed}`;
  if (/^\d+\.\d+\.\d+$/.test(trimmed)) return trimmed;
  throw new Error(`Invalid topic ID "${input}". Use 0.0.x or x.`);
}

export async function fetchTopicSnapshot(
  options: TopicSnapshotOptions,
): Promise<TopicSnapshot> {
  const topicId = normalizeTopicId(options.topicId);
  const network = options.network;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const maxRetries = options.maxRetries ?? defaultMaxRetries;

  const topic = await mirrorFetch<MirrorTopicInfo>(topicUrl(network, topicId), {
    fetchImpl,
    timeoutMs,
    maxRetries,
  });

  const page = await fetchMessagePage({
    network,
    topicId,
    limit: options.limit,
    order: options.order,
    cursor: options.cursor,
    fetchImpl,
    timeoutMs,
    maxRetries,
  });

  const standard = options.standard?.trim().toUpperCase();
  const text = options.text?.trim().toLowerCase();
  const messages = page.messages
    .map((message) => enrichMessage(network, message))
    .filter((message) => {
      if (
        standard &&
        standard !== "ALL" &&
        message.decode.standard !== standard
      )
        return false;
      if (text) {
        const haystack = [
          message.decode.decodedText,
          message.decode.summary,
          JSON.stringify(message.decode.extractedFields),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(text)) return false;
      }
      return true;
    });

  return {
    network,
    topicId,
    topic,
    messages,
    nextCursor: page.nextCursor,
    state: getSnapshotState(topic, page.messages.length),
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchMessagePage(params: {
  network: HederaNetwork;
  topicId: string;
  limit?: number;
  order?: SortOrder;
  cursor?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ messages: MirrorMessage[]; nextCursor: string | null }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const url = messagePageUrl(params);
  const data = await mirrorFetch<{
    messages?: MirrorMessage[];
    links?: { next?: string | null };
  }>(url, {
    fetchImpl,
    timeoutMs: params.timeoutMs ?? defaultTimeoutMs,
    maxRetries: params.maxRetries ?? defaultMaxRetries,
  });

  return {
    messages: data.messages ?? [],
    nextCursor: data.links?.next ?? null,
  };
}

function topicUrl(network: HederaNetwork, topicId: string): string {
  return `${getMirrorBase(network)}/api/v1/topics/${topicId}`;
}

function messagePageUrl(params: {
  network: HederaNetwork;
  topicId: string;
  limit?: number;
  order?: SortOrder;
  cursor?: string | null;
}): string {
  const base = getMirrorBase(params.network);
  if (params.cursor) {
    if (!params.cursor.startsWith("/api/v1/"))
      throw new Error("Invalid mirror cursor.");
    return `${base}${params.cursor}`;
  }

  const url = new URL(`${base}/api/v1/topics/${params.topicId}/messages`);
  url.searchParams.set(
    "limit",
    String(Math.min(Math.max(params.limit ?? 25, 1), maxPageLimit)),
  );
  url.searchParams.set("order", params.order ?? "desc");
  return url.toString();
}

async function mirrorFetch<T>(
  url: string,
  opts: { fetchImpl: typeof fetch; timeoutMs: number; maxRetries: number },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        url,
        opts.fetchImpl,
        opts.timeoutMs,
      );
      if (response.status === 404)
        throw new MirrorError(404, `Topic or message page not found: ${url}`);
      if (response.status === 429 || response.status >= 500) {
        throw new RetryableMirrorError(
          response.status,
          `Mirror node returned ${response.status}`,
        );
      }
      if (!response.ok)
        throw new MirrorError(
          response.status,
          `Mirror node returned ${response.status}`,
        );
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt >= opts.maxRetries || !isRetryable(error)) break;
      await sleep(250 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Mirror node request failed.");
}

async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function enrichMessage(
  network: HederaNetwork,
  message: MirrorMessage,
): EnrichedMessage {
  const decode = decodePayload(message.message);
  return {
    topicId: message.topic_id,
    sequenceNumber: message.sequence_number,
    consensusTimestamp: message.consensus_timestamp,
    payerAccountId: message.payer_account_id,
    chunkNumber: message.chunk_info?.number ?? null,
    chunkTotal: message.chunk_info?.total ?? null,
    rawBase64: message.message,
    rawBytesLength: Buffer.from(message.message, "base64").byteLength,
    hashscanUrl: `https://hashscan.io/${network}/topic/${message.topic_id}`,
    decode,
  };
}

function getSnapshotState(
  topic: MirrorTopicInfo,
  messageCount: number,
): TopicSnapshot["state"] {
  if (messageCount > 0) return "ok";
  const created = Number(
    topic.created_timestamp ?? topic.timestamp?.from ?? "0".split(".")[0],
  );
  const ageSeconds =
    Number.isFinite(created) && created > 0
      ? Date.now() / 1000 - created
      : Number.POSITIVE_INFINITY;
  return ageSeconds < 90 ? "indexing_delay" : "empty";
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof RetryableMirrorError ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MirrorError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MirrorError";
  }
}

class RetryableMirrorError extends MirrorError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "RetryableMirrorError";
  }
}
