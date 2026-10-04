"use client";

import { Download, ExternalLink, RefreshCw, Search, X } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

type Network = "mainnet" | "testnet" | "previewnet";

type Snapshot = {
  network: Network;
  topicId: string;
  topic: {
    memo?: string;
    deleted?: boolean;
    submit_key?: unknown;
    admin_key?: unknown;
  };
  messages: Message[];
  nextCursor: string | null;
  state: "ok" | "empty" | "indexing_delay";
  fetchedAt: string;
};

type Message = {
  sequenceNumber: number;
  consensusTimestamp: string;
  payerAccountId: string;
  chunkNumber: number | null;
  chunkTotal: number | null;
  rawBase64: string;
  rawBytesLength: number;
  hashscanUrl: string;
  decode: {
    standard: string;
    label: string;
    decodedText: string;
    parsed: unknown;
    summary: string;
    detectedBy: string;
    confidence: string;
    matchKind: string;
    extractedFields: Record<string, unknown>;
    explanation: string;
    warnings: string[];
  };
};

const defaultNetwork =
  (process.env.NEXT_PUBLIC_DEFAULT_NETWORK?.trim() as Network | undefined) ||
  "testnet";
const defaultTopicId =
  process.env.NEXT_PUBLIC_DEFAULT_TOPIC_ID?.trim() || "0.0.10862287";

export default function Home() {
  const [network, setNetwork] = useState<Network>(defaultNetwork);
  const [topicId, setTopicId] = useState(defaultTopicId);
  const [standard, setStandard] = useState("ALL");
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedSequence, setSelectedSequence] = useState<number | null>(null);
  const [detailMode, setDetailMode] = useState<"decoded" | "raw">("decoded");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () =>
      snapshot?.messages.find(
        (message) => message.sequenceNumber === selectedSequence,
      ) ??
      snapshot?.messages[0] ??
      null,
    [selectedSequence, snapshot],
  );

  async function load(nextCursor?: string | null) {
    if (!topicId.trim()) {
      setError("Enter a topic ID.");
      return;
    }

    const params = new URLSearchParams({
      network,
      topicId: topicId.trim(),
      order: "desc",
      limit: "50",
      standard,
      q: query.trim(),
    });
    if (nextCursor) params.set("cursor", nextCursor);

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/topic?${params.toString()}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Mirror request failed.");
      setSnapshot(body);
      setSelectedSequence(body.messages[0]?.sequenceNumber ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Mirror request failed.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load();
  }

  function exportJson() {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${snapshot.network}-${snapshot.topicId}-hcs-trace.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Scaffold-HBAR template</p>
          <h1>HCS Trace Lab</h1>
        </div>
        <div className="statusStrip">
          <span>{snapshot?.topicId ?? "No topic"}</span>
          <span>{snapshot?.messages.length ?? 0} messages</span>
          <span>
            {snapshot
              ? new Date(snapshot.fetchedAt).toLocaleTimeString()
              : "Idle"}
          </span>
        </div>
      </section>

      <form className="controls" onSubmit={onSubmit}>
        <label>
          Network
          <select
            value={network}
            onChange={(event) => setNetwork(event.target.value as Network)}
          >
            <option value="testnet">testnet</option>
            <option value="mainnet">mainnet</option>
            <option value="previewnet">previewnet</option>
          </select>
        </label>
        <label className="topicField">
          Topic
          <input
            value={topicId}
            onChange={(event) => setTopicId(event.target.value)}
            placeholder="0.0.x"
          />
        </label>
        <label>
          Standard
          <select
            value={standard}
            onChange={(event) => setStandard(event.target.value)}
          >
            <option value="ALL">all</option>
            <option value="HCS-10">HCS-10</option>
            <option value="HCS-2">HCS-2</option>
            <option value="HCS-11">HCS-11</option>
            <option value="CUSTOM_JSON">JSON</option>
            <option value="UNKNOWN">text</option>
          </select>
        </label>
        <label className="searchField">
          Search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="operator, memo, data"
          />
        </label>
        <button
          className="iconButton primary"
          type="submit"
          disabled={isLoading}
          title="Fetch messages"
        >
          {isLoading ? (
            <RefreshCw className="spin" size={18} />
          ) : (
            <Search size={18} />
          )}
        </button>
        <button
          className="iconButton"
          type="button"
          onClick={() => void load()}
          disabled={isLoading || !snapshot}
          title="Refresh"
        >
          <RefreshCw size={18} />
        </button>
        <button
          className="iconButton"
          type="button"
          onClick={exportJson}
          disabled={!snapshot}
          title="Export JSON"
        >
          <Download size={18} />
        </button>
      </form>

      {error ? (
        <div className="notice error">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} title="Dismiss">
            <X size={16} />
          </button>
        </div>
      ) : null}

      {snapshot?.state === "indexing_delay" ? (
        <div className="notice">
          Mirror node may still be indexing this topic.
        </div>
      ) : null}
      {snapshot?.state === "empty" ? (
        <div className="notice">No messages returned for this topic.</div>
      ) : null}

      <section className="workspace">
        <div className="messagePane">
          <div className="paneHeader">
            <span>Messages</span>
            {snapshot ? (
              <a
                href={`https://hashscan.io/${snapshot.network}/topic/${snapshot.topicId}`}
                target="_blank"
                rel="noreferrer"
                title="Open topic on Hashscan"
              >
                <ExternalLink size={16} />
              </a>
            ) : null}
          </div>
          <div className="messageList">
            {(snapshot?.messages ?? []).map((message) => (
              <button
                key={message.sequenceNumber}
                className={
                  message.sequenceNumber === selected?.sequenceNumber
                    ? "messageRow active"
                    : "messageRow"
                }
                type="button"
                onClick={() => setSelectedSequence(message.sequenceNumber)}
              >
                <span className="seq">#{message.sequenceNumber}</span>
                <span className="standard">{message.decode.standard}</span>
                <span className={`confidence ${message.decode.confidence}`}>
                  {message.decode.confidence}
                </span>
                <span className="summary">{message.decode.summary}</span>
                <span className="time">
                  {formatTimestamp(message.consensusTimestamp)}
                </span>
              </button>
            ))}
            {!snapshot ? <div className="empty">No topic loaded.</div> : null}
          </div>
        </div>

        <div className="detailPane">
          <div className="paneHeader">
            <span>
              {selected ? `Message #${selected.sequenceNumber}` : "Detail"}
            </span>
            {selected ? (
              <a
                href={selected.hashscanUrl}
                target="_blank"
                rel="noreferrer"
                title="Open on Hashscan"
              >
                <ExternalLink size={16} />
              </a>
            ) : null}
          </div>

          {selected ? (
            <>
              <div className="facts">
                <div>
                  <span>standard</span>
                  <strong>{selected.decode.standard}</strong>
                </div>
                <div>
                  <span>source</span>
                  <strong>{selected.decode.detectedBy}</strong>
                </div>
                <div>
                  <span>payer</span>
                  <strong>{selected.payerAccountId}</strong>
                </div>
                <div>
                  <span>bytes</span>
                  <strong>{selected.rawBytesLength}</strong>
                </div>
              </div>

              <p className="explanation">{selected.decode.explanation}</p>

              <div className="tabs" role="tablist" aria-label="Message detail">
                <button
                  type="button"
                  className={detailMode === "decoded" ? "active" : ""}
                  onClick={() => setDetailMode("decoded")}
                >
                  Decoded
                </button>
                <button
                  type="button"
                  className={detailMode === "raw" ? "active" : ""}
                  onClick={() => setDetailMode("raw")}
                >
                  Raw
                </button>
              </div>

              <pre>
                {detailMode === "decoded"
                  ? JSON.stringify(
                      selected.decode.parsed ?? selected.decode.decodedText,
                      null,
                      2,
                    )
                  : selected.rawBase64}
              </pre>
            </>
          ) : (
            <div className="empty">No message selected.</div>
          )}
        </div>
      </section>
    </main>
  );
}

function formatTimestamp(value: string): string {
  const seconds = Number(value.split(".")[0]);
  if (!Number.isFinite(seconds)) return value;
  return new Date(seconds * 1000).toLocaleString();
}
