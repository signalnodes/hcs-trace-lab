import type { DecodeResult } from "../decode/index.js";

export type HederaNetwork = "mainnet" | "testnet" | "previewnet";
export type SortOrder = "asc" | "desc";

export interface MirrorMessage {
  chunk_info?: {
    initial_transaction_id?: {
      account_id?: string;
      nonce?: number;
      scheduled?: boolean;
      transaction_valid_start?: string;
    };
    number?: number;
    total?: number;
  };
  consensus_timestamp: string;
  message: string;
  payer_account_id: string;
  running_hash?: string;
  running_hash_version?: number;
  sequence_number: number;
  topic_id: string;
}

export interface MirrorTopicInfo {
  admin_key?: null | { key: string; _type: string };
  auto_renew_account?: string | null;
  auto_renew_period?: number | null;
  created_timestamp?: string;
  deleted?: boolean;
  memo?: string;
  submit_key?: null | { key: string; _type: string };
  timestamp?: { from: string; to: string | null };
  topic_id: string;
}

export interface EnrichedMessage {
  topicId: string;
  sequenceNumber: number;
  consensusTimestamp: string;
  payerAccountId: string;
  chunkNumber: number | null;
  chunkTotal: number | null;
  rawBase64: string;
  rawBytesLength: number;
  hashscanUrl: string;
  decode: DecodeResult;
}

export interface TopicSnapshot {
  network: HederaNetwork;
  topicId: string;
  topic: MirrorTopicInfo;
  messages: EnrichedMessage[];
  nextCursor: string | null;
  state: "ok" | "empty" | "indexing_delay";
  fetchedAt: string;
}

export interface TopicSnapshotOptions {
  network: HederaNetwork;
  topicId: string;
  limit?: number;
  order?: SortOrder;
  cursor?: string | null;
  standard?: string | null;
  text?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}
