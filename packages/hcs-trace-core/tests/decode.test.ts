import { describe, expect, it } from "vitest";
import { decodePayload } from "../src/decode/index.js";

function b64(value: unknown): string {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8").toString("base64");
}

describe("decodePayload", () => {
  it("labels HCS-10 operations as structural matches when the minimal shape is present", () => {
    const result = decodePayload(
      b64({
        p: "hcs-10",
        op: "connection_created",
        operator_id: "0.0.1001@0.0.2002",
        connection_topic_id: "0.0.3003",
        connection_id: 7,
        m: "accepted"
      })
    );

    expect(result.standard).toBe("HCS-10");
    expect(result.detectedBy).toBe("structural");
    expect(result.matchKind).toBe("structural_match");
    expect(result.explanation).toContain("not proof of identity");
  });

  it("falls back cleanly for malformed text payloads", () => {
    const result = decodePayload(b64("hello from a plain topic"));

    expect(result.standard).toBe("UNKNOWN");
    expect(result.contentType).toBe("text");
    expect(result.matchKind).toBe("fallback");
  });

  it("uses a heuristic match for recognizable but incomplete standard payloads", () => {
    const result = decodePayload(
      b64({
        p: "hcs-10",
        op: "message"
      })
    );

    expect(result.standard).toBe("HCS-10");
    expect(result.detectedBy).toBe("heuristic");
    expect(result.confidence).toBe("medium");
  });
});
