"use client";

import type {
  FlowCheck,
  Hcs10ConnectionFlow,
  Hcs10Event,
  Hcs10Trace,
} from "@hcs-trace-lab/core";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Info,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import styles from "./trace.module.css";

type Network = "mainnet" | "testnet" | "previewnet";

const defaultNetwork =
  (process.env.NEXT_PUBLIC_DEFAULT_NETWORK?.trim() as Network | undefined) ||
  "testnet";
const defaultTopicId =
  process.env.NEXT_PUBLIC_DEFAULT_TOPIC_ID?.trim() || "0.0.10862287";

export default function TracePage() {
  const [network, setNetwork] = useState<Network>(defaultNetwork);
  const [topicId, setTopicId] = useState(defaultTopicId);
  const [trace, setTrace] = useState<Hcs10Trace | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(nextNetwork = network, nextTopicId = topicId) {
    if (!nextTopicId.trim()) {
      setError("Enter an HCS-10 inbound or connection topic ID.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        network: nextNetwork,
        topicId: nextTopicId.trim(),
      });
      const response = await fetch(`/api/trace?${params.toString()}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Trace request failed.");
      setTrace(body);
      window.history.replaceState(null, "", `/trace?${params.toString()}`);
    } catch (loadError) {
      setTrace(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Trace request failed.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrlNetwork =
      (params.get("network") as Network | null) || defaultNetwork;
    const fromUrlTopic = params.get("topicId") || defaultTopicId;
    setNetwork(fromUrlNetwork);
    setTopicId(fromUrlTopic);
    void load(fromUrlNetwork, fromUrlTopic);
    // Load once on mount with URL or default values.
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load();
  }

  function exportJson() {
    if (!trace) return;
    const blob = new Blob([JSON.stringify(trace, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${trace.network}-${trace.topicId}-hcs10-trace.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">HCS-10 connection lifecycle</p>
          <h1>Connection Trace</h1>
        </div>
        <nav className={styles.nav}>
          <Link href="/">Topic inspector</Link>
          <Link href="/trace" className={styles.current}>
            Connection trace
          </Link>
        </nav>
      </section>

      <form className={styles.controls} onSubmit={onSubmit}>
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
        <label>
          Inbound or connection topic
          <input
            value={topicId}
            onChange={(event) => setTopicId(event.target.value)}
            placeholder="0.0.x"
          />
        </label>
        <button
          className="iconButton primary"
          type="submit"
          disabled={isLoading}
          title="Trace"
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
          onClick={exportJson}
          disabled={!trace}
          title="Export JSON"
        >
          <Download size={18} />
        </button>
      </form>

      <p className={styles.hint}>
        Enter an agent&apos;s inbound topic to list its connections, or a
        connection topic to follow it back to the original request.
      </p>

      {error ? (
        <div className="notice error">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} title="Dismiss">
            <X size={16} />
          </button>
        </div>
      ) : null}

      {trace ? (
        <>
          <div className="notice">
            <span>
              {trace.entry === "connection"
                ? "Connection topic"
                : "Inbound topic"}{" "}
              {trace.topicId} · memo <code>{trace.topicMemo.raw}</code> ·{" "}
              {trace.flows.length} connection
              {trace.flows.length === 1 ? "" : "s"}
            </span>
          </div>
          {trace.warnings.map((warning) => (
            <div className="notice" key={warning}>
              {warning}
            </div>
          ))}
          {trace.flows.length === 0 ? (
            <div className="notice">
              No connection requests on this inbound topic yet.
            </div>
          ) : null}
          {trace.flows.map((flow) => (
            <FlowCard
              key={`${flow.inboundTopicId}-${flow.connectionId}`}
              flow={flow}
            />
          ))}
        </>
      ) : null}
    </main>
  );
}

function FlowCard({ flow }: { flow: Hcs10ConnectionFlow }) {
  const roleOf = (event: Hcs10Event) =>
    flow.participants.find(
      (participant) => participant.operator.raw === event.operator?.raw,
    )?.role ?? "unknown sender";

  return (
    <section className={styles.flow}>
      <header className={styles.flowHeader}>
        <span className={styles.flowTitle}>
          Connection #{flow.connectionId} on inbound {flow.inboundTopicId}
          {flow.connectionTopicId ? ` → ${flow.connectionTopicId}` : ""}
        </span>
        <span className={`${styles.status} ${styles[`status_${flow.status}`]}`}>
          {flow.status}
        </span>
      </header>

      <div className={styles.body}>
        <ol className={styles.timeline}>
          <Step
            done={Boolean(flow.request)}
            title="connection_request"
            meta={
              flow.request
                ? `inbound #${flow.request.sequenceNumber} · ${formatTimestamp(flow.request.consensusTimestamp)}`
                : "not found"
            }
            text={flow.request?.memo}
            href={flow.links.inboundTopic}
          />
          <Step
            done={Boolean(flow.confirmation)}
            title="connection_created"
            meta={
              flow.confirmation
                ? `inbound #${flow.confirmation.sequenceNumber} · ${formatTimestamp(flow.confirmation.consensusTimestamp)}`
                : "awaiting confirmation"
            }
            text={flow.confirmation?.memo}
            href={flow.links.inboundTopic}
          />
          <Step
            done={Boolean(flow.connectionTopicId)}
            title="connection topic"
            meta={flow.connectionTopicId ?? "not created"}
            text={
              flow.connectionTopicMemo
                ? `memo ${flow.connectionTopicMemo.raw}`
                : undefined
            }
            href={flow.links.connectionTopic ?? undefined}
          />
          {flow.messages.map((message) => (
            <Step
              key={message.sequenceNumber}
              done
              title="message"
              role={roleOf(message)}
              meta={`#${message.sequenceNumber} · ${formatTimestamp(message.consensusTimestamp)}`}
              text={message.memo}
              data={
                message.dataRef
                  ? `${message.dataRef} (HCS-1 reference, not resolved)`
                  : formatData(message.data)
              }
            />
          ))}
          {flow.closure ? (
            <Step
              done
              title={flow.closure.op}
              meta={`#${flow.closure.sequenceNumber} · ${formatTimestamp(flow.closure.consensusTimestamp)}`}
              text={flow.closure.memo}
            />
          ) : null}
        </ol>

        <aside className={styles.side}>
          <p className={styles.sideTitle}>Participants</p>
          <div className={styles.participants}>
            {flow.participants.map((participant) => (
              <div className={styles.participant} key={participant.role}>
                <span className={styles.role}>{participant.role}</span> account{" "}
                {participant.operator.accountId} · inbound{" "}
                {participant.operator.inboundTopicId}
              </div>
            ))}
            {flow.participants.length === 0 ? (
              <div className={styles.participant}>
                No parseable operator_id yet.
              </div>
            ) : null}
          </div>

          <p className={styles.sideTitle}>Consistency checks</p>
          <ul className={styles.checks}>
            {flow.checks.map((check) => (
              <li className={styles.check} key={check.id}>
                <CheckIcon status={check.status} />
                <div>
                  <strong>{check.label}</strong>
                  <span>{check.detail}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className={styles.disclaimer}>
            Checks compare on-chain HCS-10 messages with each other. They do not
            verify signer identity, HCS-11 profiles, or registry membership.
          </p>
        </aside>
      </div>
    </section>
  );
}

function Step(props: {
  done: boolean;
  title: string;
  meta: string;
  role?: string;
  text?: string | null;
  data?: string | null;
  href?: string;
}) {
  return (
    <li className={styles.step}>
      <span
        className={
          props.done ? styles.dot : `${styles.dot} ${styles.dotMissing}`
        }
      />
      <div className={styles.stepHead}>
        <span className={styles.stepOp}>{props.title}</span>
        {props.role ? <span className={styles.role}>{props.role}</span> : null}
        <span className={styles.stepMeta}>{props.meta}</span>
        {props.href ? (
          <a
            href={props.href}
            target="_blank"
            rel="noreferrer"
            title="Open on Hashscan"
          >
            <ExternalLink size={14} />
          </a>
        ) : null}
      </div>
      {props.text ? <p className={styles.stepText}>{props.text}</p> : null}
      {props.data ? <div className={styles.data}>{props.data}</div> : null}
    </li>
  );
}

function CheckIcon({ status }: { status: FlowCheck["status"] }) {
  if (status === "pass")
    return <CheckCircle2 className={styles.pass} size={18} />;
  if (status === "fail") return <XCircle className={styles.fail} size={18} />;
  if (status === "warn")
    return <AlertTriangle className={styles.warn} size={18} />;
  return <Info className={styles.info} size={18} />;
}

function formatData(data: string | null): string | null {
  if (data === null) return null;
  try {
    return JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    return data;
  }
}

function formatTimestamp(value: string): string {
  const seconds = Number(value.split(".")[0]);
  if (!Number.isFinite(seconds)) return value;
  return new Date(seconds * 1000).toLocaleString();
}
