import type { HederaNetwork } from "../mirror/types.js";

/** Topic roles encoded in the HCS-10 topic memo (`hcs-10:{indexed}:{ttl}:{type}:...`). */
export type Hcs10TopicKind =
  "inbound" | "outbound" | "connection" | "registry" | "unknown";

export interface Hcs10TopicMemo {
  raw: string;
  kind: Hcs10TopicKind;
  /** `0` means indexed (all messages matter), `1` means only the latest message matters. */
  indexed: boolean | null;
  ttlSeconds: number | null;
  /** Inbound topics name the owning account. */
  accountId: string | null;
  /** Connection topics name the inbound topic that accepted the request. */
  inboundTopicId: string | null;
  /** Connection topics name the inbound sequence number of the original request. */
  connectionId: number | null;
}

/** `operator_id` is `{inboundTopicId}@{accountId}` in HCS-10. */
export interface Hcs10OperatorRef {
  raw: string;
  inboundTopicId: string;
  accountId: string;
}

export type Hcs10Op =
  | "register"
  | "connection_request"
  | "connection_created"
  | "message"
  | "close_connection"
  | "connection_closed";

export interface Hcs10Event {
  op: Hcs10Op;
  topicId: string;
  sequenceNumber: number;
  consensusTimestamp: string;
  payerAccountId: string;
  operator: Hcs10OperatorRef | null;
  memo: string | null;
  connectionTopicId: string | null;
  connectionId: number | null;
  connectedAccountId: string | null;
  /** Inline message payload, when present. */
  data: string | null;
  /** `hcs://1/...` reference for large payloads stored with HCS-1. Not resolved by the tracer. */
  dataRef: string | null;
  chunkCount: number;
  raw: Record<string, unknown>;
  warnings: string[];
}

export type FlowCheckStatus = "pass" | "warn" | "fail" | "info";

export interface FlowCheck {
  id: string;
  label: string;
  status: FlowCheckStatus;
  detail: string;
}

export type FlowStatus =
  "requested" | "established" | "active" | "closed" | "incomplete";

export interface Hcs10Participant {
  role: "requester" | "responder";
  operator: Hcs10OperatorRef;
}

export interface Hcs10ConnectionFlow {
  network: HederaNetwork;
  inboundTopicId: string;
  connectionId: number;
  connectionTopicId: string | null;
  connectionTopicMemo: Hcs10TopicMemo | null;
  status: FlowStatus;
  participants: Hcs10Participant[];
  request: Hcs10Event | null;
  confirmation: Hcs10Event | null;
  messages: Hcs10Event[];
  closure: Hcs10Event | null;
  checks: FlowCheck[];
  links: {
    inboundTopic: string;
    connectionTopic: string | null;
  };
}

export interface Hcs10Trace {
  network: HederaNetwork;
  topicId: string;
  topicMemo: Hcs10TopicMemo;
  /** Which way the trace was entered. */
  entry: "connection" | "inbound";
  flows: Hcs10ConnectionFlow[];
  /** True when a message or flow cap was reached and older/extra data was skipped. */
  truncated: boolean;
  warnings: string[];
  fetchedAt: string;
}
