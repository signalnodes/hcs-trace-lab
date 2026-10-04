import type { DecodedPayload, Detector, DetectorMatch } from "./types.js";

export class HeuristicDetector implements Detector {
  readonly name = "heuristic" as const;

  detect(payload: DecodedPayload): DetectorMatch | null {
    if (
      payload.json === null ||
      typeof payload.json !== "object" ||
      Array.isArray(payload.json)
    )
      return null;

    const obj = payload.json as Record<string, unknown>;
    const protocol = String(obj.p ?? obj.standard ?? "").toLowerCase();

    if (protocol === "hcs-1") {
      return heuristic(
        "HCS-1",
        "HCS-1 Inscription",
        summarize(obj, ["op", "o", "m", "chunk"]),
        pick(obj, ["op", "o", "m", "chunk"]),
      );
    }
    if (protocol === "hcs-3") {
      return heuristic(
        "HCS-3",
        "HCS-3 File Ref",
        "recursive file reference",
        pick(obj, ["op", "data", "refs"]),
      );
    }
    if (protocol === "hcs-5") {
      return heuristic(
        "HCS-5",
        "HCS-5 Hashinal Registry",
        `op=${str(obj.op)}`,
        pick(obj, ["op", "t_id", "uid", "m"]),
      );
    }
    if (protocol === "hcs-6") {
      return heuristic(
        "HCS-6",
        "HCS-6 Dynamic Hashinal",
        `op=${str(obj.op)}`,
        pick(obj, ["op", "t_id", "uid", "m"]),
      );
    }
    if (protocol === "hcs-7") {
      return heuristic(
        "HCS-7",
        "HCS-7 Smart Hashinal",
        "smart hashinal",
        pick(obj, ["op", "data", "tick"]),
      );
    }
    if (protocol === "hcs-10") {
      return heuristic(
        "HCS-10",
        "HCS-10 Agent Comms",
        `op=${str(obj.op)}`,
        pick(obj, [
          "op",
          "operator_id",
          "connection_id",
          "connection_topic_id",
          "m",
        ]),
      );
    }
    if (protocol === "hcs-20") {
      return heuristic(
        "HCS-20",
        "HCS-20 Points",
        `op=${str(obj.op)} tick=${str(obj.tick)}`,
        pick(obj, ["op", "tick", "amt", "to", "from"]),
      );
    }
    if (protocol === "hcs-27") {
      return heuristic(
        "HCS-27",
        "HCS-27 Transparency Log",
        `op=${str(obj.op)}`,
        pick(obj, ["op", "metadata", "m"]),
      );
    }

    return null;
  }
}

function heuristic(
  standard: DetectorMatch["standard"],
  label: string,
  summary: string,
  extractedFields: Record<string, unknown>,
): DetectorMatch {
  return {
    standard,
    label,
    summary,
    confidence: "medium",
    matchKind: "heuristic_match",
    extractedFields,
    explanation:
      "Payload includes recognizable fields for this standard, but it did not pass a stricter structural detector.",
    warnings: [],
  };
}

function str(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function pick(
  obj: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields
      .filter((field) => obj[field] !== undefined)
      .map((field) => [field, obj[field]]),
  );
}

function summarize(obj: Record<string, unknown>, fields: string[]): string {
  const parts = fields
    .filter((field) => obj[field] !== undefined)
    .map((field) => `${field}=${String(obj[field]).slice(0, 32)}`);
  return parts.join(" ") || JSON.stringify(obj).slice(0, 96);
}
