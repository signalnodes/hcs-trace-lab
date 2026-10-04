import { NextResponse } from "next/server";
import {
  Hcs10TraceError,
  MirrorError,
  traceHcs10Topic,
  type HederaNetwork,
} from "@hcs-trace-lab/core";

export const dynamic = "force-dynamic";

const networks = new Set<HederaNetwork>(["mainnet", "testnet", "previewnet"]);

/**
 * GET /api/trace?network=testnet&topicId=0.0.x
 * Reconstructs HCS-10 connection flows from an inbound topic or a connection topic.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const topicId = url.searchParams.get("topicId")?.trim();
  const network = (url.searchParams.get("network")?.trim() ||
    "testnet") as HederaNetwork;

  if (!topicId)
    return NextResponse.json({ error: "topicId is required" }, { status: 400 });
  if (!networks.has(network))
    return NextResponse.json({ error: "Invalid network" }, { status: 400 });

  try {
    const trace = await traceHcs10Topic({ network, topicId });
    return NextResponse.json(trace);
  } catch (error) {
    if (error instanceof Hcs10TraceError) {
      return NextResponse.json(
        { error: error.message, memo: error.memo },
        { status: 422 },
      );
    }
    if (error instanceof MirrorError) {
      return NextResponse.json(
        { error: error.message, status: error.status },
        { status: error.status === 404 ? 404 : 502 },
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message.startsWith("Invalid") ? 400 : 500 },
    );
  }
}
