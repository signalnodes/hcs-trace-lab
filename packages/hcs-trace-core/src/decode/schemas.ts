import { z } from "zod";
import type { DetectorMatch } from "./types.js";

const stringish = z.union([z.string(), z.number()]).transform(String);

const hcs10Base = z.object({
  p: z.literal("hcs-10"),
  op: z.enum([
    "register",
    "connection_request",
    "connection_created",
    "message",
    "close_connection",
    "connection_closed",
  ]),
});

const hcs10Schemas = [
  hcs10Base.extend({
    op: z.literal("connection_request"),
    operator_id: z.string().min(1),
    m: z.string().optional(),
  }),
  hcs10Base.extend({
    op: z.literal("connection_created"),
    connection_topic_id: z.string().min(1),
    operator_id: z.string().min(1),
    connection_id: z.union([z.number(), z.string()]),
    connected_account_id: z.string().optional(),
    m: z.string().optional(),
  }),
  hcs10Base.extend({
    op: z.literal("message"),
    operator_id: z.string().min(1),
    data: z.unknown(),
    m: z.string().optional(),
  }),
  hcs10Base.extend({
    op: z.literal("register"),
    account_id: z.string().min(1),
    inbound_topic_id: z.string().optional(),
    m: z.string().optional(),
  }),
];

const hcs2 = z.object({
  p: z.literal("hcs-2"),
  op: z.enum(["register", "delete", "migrate"]),
  t_id: z.string().optional(),
  uid: z.string().optional(),
  m: z.string().optional(),
});

const hcs11 = z.object({
  version: stringish,
  type: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal("0"),
    z.literal("1"),
    z.literal("2"),
    z.literal("3"),
  ]),
  display_name: z.string().min(1),
});

export function tryStructuralMatch(value: unknown): DetectorMatch | null {
  for (const schema of hcs10Schemas) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) continue;
    const data = parsed.data;
    return {
      standard: "HCS-10",
      label: "HCS-10 Agent Comms",
      summary: `op=${data.op}`,
      confidence: "high",
      matchKind: "structural_match",
      extractedFields: pick(data, [
        "op",
        "operator_id",
        "connection_topic_id",
        "connection_id",
        "connected_account_id",
        "account_id",
        "inbound_topic_id",
        "m",
      ]),
      explanation:
        "Payload matched the minimal HCS-10 operation shape used by the inspector. This is structural detection, not proof of identity or full protocol compliance.",
      warnings: [],
    };
  }

  const hcs2Result = hcs2.safeParse(value);
  if (hcs2Result.success) {
    return {
      standard: "HCS-2",
      label: "HCS-2 Registry",
      summary: `op=${hcs2Result.data.op}`,
      confidence: "high",
      matchKind: "structural_match",
      extractedFields: pick(hcs2Result.data, ["op", "t_id", "uid", "m"]),
      explanation:
        "Payload matched the minimal HCS-2 registry shape. This is structural detection, not full registry validation.",
      warnings: [],
    };
  }

  const hcs11Result = hcs11.safeParse(value);
  if (hcs11Result.success) {
    return {
      standard: "HCS-11",
      label: "HCS-11 Profile",
      summary: hcs11Result.data.display_name,
      confidence: "high",
      matchKind: "structural_match",
      extractedFields: pick(hcs11Result.data, [
        "version",
        "type",
        "display_name",
      ]),
      explanation:
        "Payload matched the minimal HCS-11 profile shape. This is structural detection, not profile authenticity verification.",
      warnings: [],
    };
  }

  return null;
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
