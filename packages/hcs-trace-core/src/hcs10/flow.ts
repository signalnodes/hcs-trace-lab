import type { HederaNetwork } from "../mirror/types.js";
import type {
  FlowCheck,
  FlowStatus,
  Hcs10ConnectionFlow,
  Hcs10Event,
  Hcs10Participant,
  Hcs10TopicMemo,
} from "./types.js";

export interface BuildFlowInput {
  network: HederaNetwork;
  inboundTopicId: string;
  connectionId: number;
  /** Events read from the inbound topic. */
  inboundEvents: Hcs10Event[];
  /** Known connection topic (from its memo, or from the confirmation). */
  connectionTopicId?: string | null;
  connectionTopicMemo?: Hcs10TopicMemo | null;
  /** Events read from the connection topic, when it was fetched. */
  connectionEvents?: Hcs10Event[] | null;
}

/**
 * Joins one HCS-10 connection across topics:
 * inbound `connection_request` (sequence N) -> inbound `connection_created` (connection_id N)
 * -> connection topic messages -> optional close.
 *
 * Checks are consistency checks between on-chain messages. They do not verify signer identity,
 * HCS-11 profiles, or registry membership.
 */
export function buildConnectionFlow(
  input: BuildFlowInput,
): Hcs10ConnectionFlow {
  const { network, inboundTopicId, connectionId, inboundEvents } = input;

  const request =
    inboundEvents.find(
      (event) =>
        event.op === "connection_request" &&
        event.sequenceNumber === connectionId,
    ) ?? null;
  const confirmations = inboundEvents.filter(
    (event) =>
      event.op === "connection_created" && event.connectionId === connectionId,
  );
  const confirmation =
    confirmations.find(
      (event) =>
        input.connectionTopicId &&
        event.connectionTopicId === input.connectionTopicId,
    ) ??
    confirmations[0] ??
    null;

  const connectionTopicId =
    input.connectionTopicId ?? confirmation?.connectionTopicId ?? null;
  const connectionEvents = input.connectionEvents ?? [];
  const messages = connectionEvents.filter((event) => event.op === "message");
  const closure =
    connectionEvents.find(
      (event) =>
        event.op === "close_connection" || event.op === "connection_closed",
    ) ??
    inboundEvents.find(
      (event) =>
        event.op === "connection_closed" && event.connectionId === connectionId,
    ) ??
    null;

  const participants: Hcs10Participant[] = [];
  if (request?.operator)
    participants.push({ role: "requester", operator: request.operator });
  if (confirmation?.operator)
    participants.push({ role: "responder", operator: confirmation.operator });

  const checks: FlowCheck[] = [];
  const add = (check: FlowCheck) => checks.push(check);

  add(
    request
      ? pass(
          "request_found",
          "Connection request",
          `connection_request found at inbound sequence #${connectionId}.`,
        )
      : fail(
          "request_found",
          "Connection request",
          `No connection_request at sequence #${connectionId} on inbound topic ${inboundTopicId} (it may be outside the fetched range).`,
        ),
  );

  if (request) {
    add(
      request.operator
        ? pass(
            "request_operator",
            "Requester operator_id",
            `Requester is ${request.operator.accountId} via inbound topic ${request.operator.inboundTopicId}.`,
          )
        : warn(
            "request_operator",
            "Requester operator_id",
            "Request has no parseable operator_id, so the requester cannot be identified.",
          ),
    );
  }

  if (!confirmation) {
    add(
      warn(
        "confirmation_found",
        "Connection confirmation",
        `No connection_created with connection_id ${connectionId} yet.`,
      ),
    );
  } else {
    add(
      pass(
        "confirmation_found",
        "Connection confirmation",
        `connection_created found at inbound sequence #${confirmation.sequenceNumber}.`,
      ),
    );
    if (confirmations.length > 1) {
      add(
        warn(
          "confirmation_unique",
          "Single confirmation",
          `${confirmations.length} confirmations reference connection_id ${connectionId}.`,
        ),
      );
    }

    if (
      input.connectionTopicId &&
      confirmation.connectionTopicId !== input.connectionTopicId
    ) {
      add(
        fail(
          "confirmation_topic",
          "Confirmation points at this topic",
          `Confirmation names ${confirmation.connectionTopicId ?? "no topic"}, but the traced connection topic is ${input.connectionTopicId}.`,
        ),
      );
    } else if (confirmation.connectionTopicId) {
      add(
        pass(
          "confirmation_topic",
          "Confirmation points at this topic",
          `Confirmation names connection topic ${confirmation.connectionTopicId}.`,
        ),
      );
    }

    if (request) {
      add(
        compareTimestamps(
          confirmation.consensusTimestamp,
          request.consensusTimestamp,
        ) > 0
          ? pass(
              "confirmation_order",
              "Request before confirmation",
              "Confirmation reached consensus after the request.",
            )
          : fail(
              "confirmation_order",
              "Request before confirmation",
              "Confirmation reached consensus before the request it answers.",
            ),
      );
    }

    if (confirmation.operator) {
      add(
        confirmation.operator.inboundTopicId === inboundTopicId
          ? pass(
              "responder_inbound",
              "Responder owns the inbound topic",
              `Responder operator_id names inbound topic ${inboundTopicId}.`,
            )
          : warn(
              "responder_inbound",
              "Responder owns the inbound topic",
              `Responder operator_id names ${confirmation.operator.inboundTopicId}, not ${inboundTopicId}.`,
            ),
      );
    }
  }

  const memo = input.connectionTopicMemo ?? null;
  if (memo) {
    if (memo.kind !== "connection") {
      add(
        warn(
          "memo_kind",
          "Connection topic memo",
          `Topic memo "${memo.raw}" is not an HCS-10 connection memo.`,
        ),
      );
    } else if (
      memo.inboundTopicId !== inboundTopicId ||
      memo.connectionId !== connectionId
    ) {
      add(
        fail(
          "memo_kind",
          "Connection topic memo",
          `Memo names inbound ${memo.inboundTopicId ?? "?"} / connection ${memo.connectionId ?? "?"}, expected ${inboundTopicId} / ${connectionId}.`,
        ),
      );
    } else {
      add(
        pass(
          "memo_kind",
          "Connection topic memo",
          `Memo "${memo.raw}" links back to inbound ${inboundTopicId}, connection ${connectionId}.`,
        ),
      );
    }
  }

  if (messages.length > 0) {
    const known = new Set(
      participants.map((participant) => participant.operator.raw),
    );
    const strangers = unique(
      messages
        .map((event) => event.operator?.raw ?? "(missing operator_id)")
        .filter((raw) => !known.has(raw)),
    );
    add(
      strangers.length === 0
        ? pass(
            "message_senders",
            "Messages come from participants",
            `All ${messages.length} messages use a participant operator_id.`,
          )
        : warn(
            "message_senders",
            "Messages come from participants",
            `Unrecognized senders: ${strangers.join(", ")}.`,
          ),
    );

    if (confirmation) {
      const early = messages.filter(
        (event) =>
          compareTimestamps(
            event.consensusTimestamp,
            confirmation.consensusTimestamp,
          ) < 0,
      );
      add(
        early.length === 0
          ? pass(
              "message_order",
              "Messages after confirmation",
              "Every message reached consensus after the confirmation.",
            )
          : warn(
              "message_order",
              "Messages after confirmation",
              `${early.length} message(s) predate the confirmation.`,
            ),
      );
    }

    const payerMismatch = messages.filter(
      (event) =>
        event.operator && event.operator.accountId !== event.payerAccountId,
    ).length;
    if (payerMismatch > 0) {
      add(
        info(
          "payer_operator",
          "Payer vs operator account",
          `${payerMismatch} message(s) were paid by an account other than the one in operator_id. HCS-10 does not require these to match, and neither value proves identity.`,
        ),
      );
    }

    const refs = messages.filter((event) => event.dataRef).length;
    if (refs > 0) {
      add(
        info(
          "data_refs",
          "Large payloads",
          `${refs} message(s) carry an hcs://1/ reference. The tracer does not resolve HCS-1 content.`,
        ),
      );
    }
  } else if (connectionTopicId && input.connectionEvents) {
    add(
      info(
        "message_senders",
        "Messages",
        "Connection topic has no messages yet.",
      ),
    );
  }

  const [first, second] = participants;
  if (
    first &&
    second &&
    first.operator.accountId === second.operator.accountId
  ) {
    add(
      info(
        "shared_account",
        "Shared operator account",
        `Both participants use account ${first.operator.accountId}. This is common in single-operator demos and means the trace cannot distinguish the two agents by account.`,
      ),
    );
  }

  for (const event of [request, confirmation, ...messages].filter(
    (event): event is Hcs10Event => Boolean(event),
  )) {
    for (const warning of event.warnings) {
      add(
        warn(
          `event_${event.topicId}_${event.sequenceNumber}`,
          `Message #${event.sequenceNumber} on ${event.topicId}`,
          warning,
        ),
      );
    }
  }

  return {
    network,
    inboundTopicId,
    connectionId,
    connectionTopicId,
    connectionTopicMemo: memo,
    status: getStatus({ request, confirmation, messages, closure }),
    participants,
    request,
    confirmation,
    messages,
    closure,
    checks,
    links: {
      inboundTopic: hashscanTopic(network, inboundTopicId),
      connectionTopic: connectionTopicId
        ? hashscanTopic(network, connectionTopicId)
        : null,
    },
  };
}

/** Compares Hedera `seconds.nanos` timestamps without floating point loss. */
export function compareTimestamps(a: string, b: string): number {
  const [aSec = "0", aNano = "0"] = a.split(".");
  const [bSec = "0", bNano = "0"] = b.split(".");
  const seconds = BigInt(aSec) - BigInt(bSec);
  if (seconds !== 0n) return seconds > 0n ? 1 : -1;
  const nanos = BigInt(aNano.padEnd(9, "0")) - BigInt(bNano.padEnd(9, "0"));
  return nanos === 0n ? 0 : nanos > 0n ? 1 : -1;
}

function getStatus(flow: {
  request: Hcs10Event | null;
  confirmation: Hcs10Event | null;
  messages: Hcs10Event[];
  closure: Hcs10Event | null;
}): FlowStatus {
  if (flow.closure) return "closed";
  if (flow.confirmation && flow.messages.length > 0) return "active";
  if (flow.confirmation) return "established";
  if (flow.request) return "requested";
  return "incomplete";
}

function hashscanTopic(network: HederaNetwork, topicId: string): string {
  return `https://hashscan.io/${network}/topic/${topicId}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const pass = (id: string, label: string, detail: string): FlowCheck => ({
  id,
  label,
  status: "pass",
  detail,
});
const warn = (id: string, label: string, detail: string): FlowCheck => ({
  id,
  label,
  status: "warn",
  detail,
});
const fail = (id: string, label: string, detail: string): FlowCheck => ({
  id,
  label,
  status: "fail",
  detail,
});
const info = (id: string, label: string, detail: string): FlowCheck => ({
  id,
  label,
  status: "info",
  detail,
});
