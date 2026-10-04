import { describe, expect, it, vi } from "vitest";
import { fetchTopicSnapshot, normalizeTopicId } from "../src/mirror/index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function message(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

describe("mirror helpers", () => {
  it("normalizes shorthand topic IDs", () => {
    expect(normalizeTopicId("1234")).toBe("0.0.1234");
    expect(normalizeTopicId("0.0.1234")).toBe("0.0.1234");
    expect(() => normalizeTopicId("abc")).toThrow("Invalid topic ID");
  });

  it("fetches and decodes a bounded topic snapshot", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          topic_id: "0.0.5005",
          memo: "hcs-10:0:60:0:0.0.1001",
          created_timestamp: "1770000000.000000000"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          messages: [
            {
              consensus_timestamp: "1770000001.000000000",
              message: message({ p: "hcs-10", op: "message", operator_id: "0.0.5005@0.0.1001", data: "ping" }),
              payer_account_id: "0.0.1001",
              sequence_number: 1,
              topic_id: "0.0.5005"
            }
          ],
          links: { next: null }
        })
      );

    const snapshot = await fetchTopicSnapshot({
      network: "testnet",
      topicId: "0.0.5005",
      limit: 500,
      fetchImpl
    });

    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0]?.decode.standard).toBe("HCS-10");
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("limit=100");
  });

  it("retries transient mirror errors", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ topic_id: "0.0.5005" }))
      .mockResolvedValueOnce(jsonResponse({ _status: { messages: [] } }, 429))
      .mockResolvedValueOnce(jsonResponse({ messages: [], links: { next: null } }));

    const snapshot = await fetchTopicSnapshot({
      network: "testnet",
      topicId: "0.0.5005",
      fetchImpl,
      maxRetries: 1
    });

    expect(snapshot.messages).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
