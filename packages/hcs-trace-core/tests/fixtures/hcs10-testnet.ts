/**
 * Real testnet mirror node responses from the HCS Trace Lab demo run (October 4, 2026).
 * Bob inbound: 0.0.10854409, connection topic: 0.0.10854412, operator account: 0.0.8009862.
 */
import type { MirrorMessage } from "../../src/mirror/types.js";

const chunk = (validStart: string) => ({
  initial_transaction_id: {
    account_id: "0.0.8009862",
    nonce: 0,
    scheduled: false,
    transaction_valid_start: validStart,
  },
  number: 1,
  total: 1,
});

export const bobInboundTopic = {
  topic_id: "0.0.10854409",
  memo: "hcs-10:0:3600:0:0.0.8009862",
  created_timestamp: "1791101492.891507951",
};

export const connectionTopic = {
  topic_id: "0.0.10854412",
  memo: "hcs-10:1:3600:2:0.0.10854409:1",
  created_timestamp: "1791101496.001333384",
};

export const bobOutboundTopic = {
  topic_id: "0.0.10854410",
  memo: "hcs-10:0:3600:1",
  created_timestamp: "1791101492.000264527",
};

export const bobInboundMessages: MirrorMessage[] = [
  {
    chunk_info: chunk("1791101488.343395261"),
    consensus_timestamp: "1791101494.520328662",
    message:
      "eyJwIjoiaGNzLTEwIiwib3AiOiJjb25uZWN0aW9uX3JlcXVlc3QiLCJvcGVyYXRvcl9pZCI6IjAuMC4xMDg1NDQwNkAwLjAuODAwOTg2MiIsIm0iOiJUcmFjZSBMYWIgQWxpY2UgcmVxdWVzdHMgYSBjb25uZWN0aW9uIHRvIEJvYi4ifQ==",
    payer_account_id: "0.0.8009862",
    sequence_number: 1,
    topic_id: "0.0.10854409",
  },
  {
    chunk_info: chunk("1791101489.201552142"),
    consensus_timestamp: "1791101496.841419104",
    message:
      "eyJwIjoiaGNzLTEwIiwib3AiOiJjb25uZWN0aW9uX2NyZWF0ZWQiLCJjb25uZWN0aW9uX3RvcGljX2lkIjoiMC4wLjEwODU0NDEyIiwiY29ubmVjdGVkX2FjY291bnRfaWQiOiIwLjAuODAwOTg2MiIsIm9wZXJhdG9yX2lkIjoiMC4wLjEwODU0NDA5QDAuMC44MDA5ODYyIiwiY29ubmVjdGlvbl9pZCI6MSwibSI6IlRyYWNlIExhYiBCb2IgYWNjZXB0cyB0aGUgY29ubmVjdGlvbi4ifQ==",
    payer_account_id: "0.0.8009862",
    sequence_number: 2,
    topic_id: "0.0.10854409",
  },
];

export const connectionMessages: MirrorMessage[] = [
  {
    chunk_info: chunk("1791101491.241946338"),
    consensus_timestamp: "1791101498.341522104",
    message:
      "eyJwIjoiaGNzLTEwIiwib3AiOiJtZXNzYWdlIiwib3BlcmF0b3JfaWQiOiIwLjAuMTA4NTQ0MDZAMC4wLjgwMDk4NjIiLCJkYXRhIjoie1widHlwZVwiOlwidHJhY2VfbGFiX3BpbmdcIixcImJvZHlcIjpcIkNhbiB5b3UgY29uZmlybSB0aGUgZGVjb2RlciBzZWVzIHRoaXMgSENTLTEwIGV4Y2hhbmdlP1wiLFwic2VudEF0XCI6XCIyMDI2LTEwLTA0VDA4OjExOjM2LjMzNFpcIn0iLCJtIjoiQWxpY2UgYXNrcyBCb2IgdG8gY29uZmlybSB0aGUgdHJhY2UuIn0=",
    payer_account_id: "0.0.8009862",
    sequence_number: 1,
    topic_id: "0.0.10854412",
  },
  {
    chunk_info: chunk("1791101489.706370045"),
    consensus_timestamp: "1791101499.041883104",
    message:
      "eyJwIjoiaGNzLTEwIiwib3AiOiJtZXNzYWdlIiwib3BlcmF0b3JfaWQiOiIwLjAuMTA4NTQ0MDlAMC4wLjgwMDk4NjIiLCJkYXRhIjoie1widHlwZVwiOlwidHJhY2VfbGFiX2Fja1wiLFwiYm9keVwiOlwiQ29uZmlybWVkLiBUaGlzIG1lc3NhZ2Ugd2FzIHN1Ym1pdHRlZCB0aHJvdWdoIHRoZSBIT0wgSENTLTEwIGJ1aWxkZXIgZmxvdy5cIixcInNlbnRBdFwiOlwiMjAyNi0xMC0wNFQwODoxMTozNy4wMzBaXCJ9IiwibSI6IkJvYiBjb25maXJtcyB0aGUgdHJhY2UuIn0=",
    payer_account_id: "0.0.8009862",
    sequence_number: 2,
    topic_id: "0.0.10854412",
  },
];

/** Helper for synthetic cases: encode a JSON payload the way the mirror node returns it. */
export function encode(value: unknown): string {
  return Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value),
    "utf8",
  ).toString("base64");
}

export function mirrorMessage(
  topicId: string,
  sequence: number,
  payload: unknown,
  overrides: Partial<MirrorMessage> = {},
): MirrorMessage {
  return {
    consensus_timestamp: `1791200000.${String(sequence).padStart(9, "0")}`,
    message: encode(payload),
    payer_account_id: "0.0.1001",
    sequence_number: sequence,
    topic_id: topicId,
    ...overrides,
  };
}
