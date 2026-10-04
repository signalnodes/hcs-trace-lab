import { NextResponse } from "next/server";
import {
  MirrorError,
  fetchTopicSnapshot,
  type HederaNetwork,
  type SortOrder,
} from "@hcs-trace-lab/core";

export const dynamic = "force-dynamic";

const networks = new Set<HederaNetwork>(["mainnet", "testnet", "previewnet"]);
const orders = new Set<SortOrder>(["asc", "desc"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const topicId = url.searchParams.get("topicId")?.trim();
  const cursor = url.searchParams.get("cursor");
  const standard = url.searchParams.get("standard");
  const text = url.searchParams.get("q");

  if (!topicId) {
    return NextResponse.json({ error: "topicId is required" }, { status: 400 });
  }

  try {
    const network = parseNetwork(url.searchParams.get("network"));
    const order = parseOrder(url.searchParams.get("order"));
    const limit = parseLimit(url.searchParams.get("limit"));
    const snapshot = await fetchTopicSnapshot({
      network,
      topicId,
      order,
      limit,
      cursor,
      standard,
      text,
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    if (error instanceof MirrorError) {
      return NextResponse.json(
        { error: error.message, status: error.status },
        { status: error.status === 404 ? 404 : 502 },
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Invalid") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function parseNetwork(value: string | null): HederaNetwork {
  const network = (value || "testnet") as HederaNetwork;
  if (!networks.has(network)) throw new Error("Invalid network");
  return network;
}

function parseOrder(value: string | null): SortOrder {
  const order = (value || "desc") as SortOrder;
  if (!orders.has(order)) throw new Error("Invalid order");
  return order;
}

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? "25");
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}
