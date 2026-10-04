import {
  Client,
  Hbar,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransactionReceipt,
} from "@hashgraph/sdk";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Network = "mainnet" | "testnet" | "previewnet";

type TxEvidence = {
  label: string;
  transactionId: string;
  mirrorTransactionId: string;
  transactionHashscanUrl: string;
  mirrorTransactionUrl: string;
  hashscanUrl: string;
  topicId?: string;
  sequenceNumber?: number;
};

type DemoEvidence = {
  network: Network;
  operatorAccountId: string;
  aliceInboundTopicId: string;
  aliceOutboundTopicId: string;
  bobInboundTopicId: string;
  bobOutboundTopicId: string;
  connectionTopicId: string;
  connectionRequestSequence: number;
  mirrorUrls: {
    connectionTopicMessages: string;
    bobInboundMessages: string;
  };
  transactions: TxEvidence[];
};

type Hcs10TxBuilder<TTransaction> = (
  params: Record<string, unknown>,
) => TTransaction;

type Hcs10TxBuilders = {
  buildHcs10ConfirmConnectionTx: Hcs10TxBuilder<TopicMessageSubmitTransaction>;
  buildHcs10CreateConnectionTopicTx: Hcs10TxBuilder<TopicCreateTransaction>;
  buildHcs10CreateInboundTopicTx: Hcs10TxBuilder<TopicCreateTransaction>;
  buildHcs10CreateOutboundTopicTx: Hcs10TxBuilder<TopicCreateTransaction>;
  buildHcs10OutboundConnectionCreatedRecordTx: Hcs10TxBuilder<TopicMessageSubmitTransaction>;
  buildHcs10OutboundConnectionRequestRecordTx: Hcs10TxBuilder<TopicMessageSubmitTransaction>;
  buildHcs10SendMessageTx: Hcs10TxBuilder<TopicMessageSubmitTransaction>;
  buildHcs10SubmitConnectionRequestTx: Hcs10TxBuilder<TopicMessageSubmitTransaction>;
};

const HCS10_BUILDER_NAMES = [
  "buildHcs10ConfirmConnectionTx",
  "buildHcs10CreateConnectionTopicTx",
  "buildHcs10CreateInboundTopicTx",
  "buildHcs10CreateOutboundTopicTx",
  "buildHcs10OutboundConnectionCreatedRecordTx",
  "buildHcs10OutboundConnectionRequestRecordTx",
  "buildHcs10SendMessageTx",
  "buildHcs10SubmitConnectionRequestTx",
] as const satisfies readonly (keyof Hcs10TxBuilders)[];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

async function main() {
  const {
    buildHcs10ConfirmConnectionTx,
    buildHcs10CreateConnectionTopicTx,
    buildHcs10CreateInboundTopicTx,
    buildHcs10CreateOutboundTopicTx,
    buildHcs10OutboundConnectionCreatedRecordTx,
    buildHcs10OutboundConnectionRequestRecordTx,
    buildHcs10SendMessageTx,
    buildHcs10SubmitConnectionRequestTx,
  } = await loadHcs10TxBuilders();
  const network = parseNetwork(process.env.HEDERA_NETWORK?.trim() || "testnet");
  assertDemoNetwork(network);
  const operatorAccountId = requireFirstEnv([
    "HEDERA_ACCOUNT_ID",
    "HEDERA_OPERATOR_ID",
  ]);
  const operatorPrivateKey = parsePrivateKey(
    requireFirstEnv(["HEDERA_PRIVATE_KEY", "HEDERA_OPERATOR_KEY"]),
  );
  const operatorPublicKey = operatorPrivateKey.publicKey;
  const client = createClient(network, operatorAccountId, operatorPrivateKey);
  const transactions: TxEvidence[] = [];

  console.log(
    `Creating HCS-10 demo exchange on ${network} as ${operatorAccountId}`,
  );

  const aliceInbound = await createTopic(
    client,
    network,
    "alice inbound",
    buildHcs10CreateInboundTopicTx({
      accountId: operatorAccountId,
      ttl: 3600,
      adminKey: operatorPublicKey,
      submitKey: false,
      operatorPublicKey,
    }),
  );
  transactions.push(aliceInbound);

  const aliceOutbound = await createTopic(
    client,
    network,
    "alice outbound",
    buildHcs10CreateOutboundTopicTx({
      ttl: 3600,
      adminKey: operatorPublicKey,
      submitKey: operatorPublicKey,
      operatorPublicKey,
    }),
  );
  transactions.push(aliceOutbound);

  const bobInbound = await createTopic(
    client,
    network,
    "bob inbound",
    buildHcs10CreateInboundTopicTx({
      accountId: operatorAccountId,
      ttl: 3600,
      adminKey: operatorPublicKey,
      submitKey: false,
      operatorPublicKey,
    }),
  );
  transactions.push(bobInbound);

  const bobOutbound = await createTopic(
    client,
    network,
    "bob outbound",
    buildHcs10CreateOutboundTopicTx({
      ttl: 3600,
      adminKey: operatorPublicKey,
      submitKey: operatorPublicKey,
      operatorPublicKey,
    }),
  );
  transactions.push(bobOutbound);

  const aliceOperatorId = `${aliceInbound.topicId}@${operatorAccountId}`;
  const bobOperatorId = `${bobInbound.topicId}@${operatorAccountId}`;

  const request = await submitMessage(
    client,
    network,
    "connection request",
    bobInbound.topicId!,
    buildHcs10SubmitConnectionRequestTx({
      inboundTopicId: bobInbound.topicId!,
      operatorId: aliceOperatorId,
      memo: "Trace Lab Alice requests a connection to Bob.",
    }),
  );
  transactions.push(request);

  if (!request.sequenceNumber) {
    throw new Error(
      "Connection request did not return a topic sequence number.",
    );
  }

  const outboundRequest = await submitMessage(
    client,
    network,
    "alice outbound request record",
    aliceOutbound.topicId!,
    buildHcs10OutboundConnectionRequestRecordTx({
      outboundTopicId: aliceOutbound.topicId!,
      operatorId: bobOperatorId,
      connectionRequestId: request.sequenceNumber,
      memo: "Outbound record for Bob connection request.",
    }),
  );
  transactions.push(outboundRequest);

  const connectionTopic = await createTopic(
    client,
    network,
    "connection topic",
    buildHcs10CreateConnectionTopicTx({
      ttl: 3600,
      inboundTopicId: bobInbound.topicId!,
      connectionId: request.sequenceNumber,
      adminKey: operatorPublicKey,
      submitKey: operatorPublicKey,
      operatorPublicKey,
    }),
  );
  transactions.push(connectionTopic);

  const confirmation = await submitMessage(
    client,
    network,
    "connection confirmation",
    bobInbound.topicId!,
    buildHcs10ConfirmConnectionTx({
      inboundTopicId: bobInbound.topicId!,
      connectionTopicId: connectionTopic.topicId!,
      connectedAccountId: operatorAccountId,
      operatorId: bobOperatorId,
      connectionId: request.sequenceNumber,
      memo: "Trace Lab Bob accepts the connection.",
    }),
  );
  transactions.push(confirmation);

  const outboundConfirmation = await submitMessage(
    client,
    network,
    "bob outbound confirmation record",
    bobOutbound.topicId!,
    buildHcs10OutboundConnectionCreatedRecordTx({
      outboundTopicId: bobOutbound.topicId!,
      requestorOutboundTopicId: aliceOutbound.topicId!,
      connectionTopicId: connectionTopic.topicId!,
      confirmedRequestId: confirmation.sequenceNumber ?? request.sequenceNumber,
      connectionRequestId: request.sequenceNumber,
      operatorId: aliceOperatorId,
      memo: "Outbound record for accepted Trace Lab connection.",
    }),
  );
  transactions.push(outboundConfirmation);

  const aliceMessage = await submitMessage(
    client,
    network,
    "alice message",
    connectionTopic.topicId!,
    buildHcs10SendMessageTx({
      connectionTopicId: connectionTopic.topicId!,
      operatorId: aliceOperatorId,
      data: JSON.stringify({
        type: "trace_lab_ping",
        body: "Can you confirm the decoder sees this HCS-10 exchange?",
        sentAt: new Date().toISOString(),
      }),
      memo: "Alice asks Bob to confirm the trace.",
    }),
  );
  transactions.push(aliceMessage);

  const bobMessage = await submitMessage(
    client,
    network,
    "bob message",
    connectionTopic.topicId!,
    buildHcs10SendMessageTx({
      connectionTopicId: connectionTopic.topicId!,
      operatorId: bobOperatorId,
      data: JSON.stringify({
        type: "trace_lab_ack",
        body: "Confirmed. This message was submitted through the HOL HCS-10 builder flow.",
        sentAt: new Date().toISOString(),
      }),
      memo: "Bob confirms the trace.",
    }),
  );
  transactions.push(bobMessage);

  const evidence: DemoEvidence = {
    network,
    operatorAccountId,
    aliceInboundTopicId: aliceInbound.topicId!,
    aliceOutboundTopicId: aliceOutbound.topicId!,
    bobInboundTopicId: bobInbound.topicId!,
    bobOutboundTopicId: bobOutbound.topicId!,
    connectionTopicId: connectionTopic.topicId!,
    connectionRequestSequence: request.sequenceNumber,
    mirrorUrls: {
      connectionTopicMessages: mirrorTopicMessagesUrl(
        network,
        connectionTopic.topicId!,
      ),
      bobInboundMessages: mirrorTopicMessagesUrl(network, bobInbound.topicId!),
    },
    transactions,
  };

  const outputDir = path.resolve(__dirname, "../demo-output");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "hcs10-last-run.json"),
    JSON.stringify(evidence, null, 2),
  );

  console.log(JSON.stringify(evidence, null, 2));
  console.log(`Inspect the connection topic: ${connectionTopic.hashscanUrl}`);
  console.log(
    `Set NEXT_PUBLIC_DEFAULT_TOPIC_ID=${connectionTopic.topicId} to load this exchange by default.`,
  );

  client.close();
}

function createClient(
  network: Network,
  accountId: string,
  privateKey: PrivateKey,
): Client {
  const client =
    network === "mainnet"
      ? Client.forMainnet()
      : network === "previewnet"
        ? Client.forPreviewnet()
        : Client.forTestnet();
  client.setOperator(accountId, privateKey);
  client.setDefaultMaxTransactionFee(new Hbar(5));
  client.setDefaultMaxQueryPayment(new Hbar(1));
  return client;
}

async function loadHcs10TxBuilders(): Promise<Hcs10TxBuilders> {
  const sdk =
    (await import("@hashgraphonline/standards-sdk")) as unknown as Partial<Hcs10TxBuilders>;
  const missingBuilders = HCS10_BUILDER_NAMES.filter(
    (builderName) => typeof sdk[builderName] !== "function",
  );

  if (missingBuilders.length > 0) {
    throw new Error(
      `@hashgraphonline/standards-sdk is missing HCS-10 builders: ${missingBuilders.join(", ")}`,
    );
  }

  return sdk as Hcs10TxBuilders;
}

async function createTopic(
  client: Client,
  network: Network,
  label: string,
  transaction: TopicCreateTransaction,
): Promise<TxEvidence> {
  const response = await transaction.execute(client);
  const receipt = await response.getReceipt(client);
  assertStatus(receipt, label);
  const topicId = receipt.topicId?.toString();
  if (!topicId) throw new Error(`${label} did not return a topic ID.`);
  return {
    label,
    transactionId: response.transactionId.toString(),
    mirrorTransactionId: toMirrorTransactionId(
      response.transactionId.toString(),
    ),
    transactionHashscanUrl: hashscanTransactionUrl(
      network,
      response.transactionId.toString(),
    ),
    mirrorTransactionUrl: mirrorTransactionUrl(
      network,
      response.transactionId.toString(),
    ),
    hashscanUrl: `https://hashscan.io/${network}/topic/${topicId}`,
    topicId,
  };
}

async function submitMessage(
  client: Client,
  network: Network,
  label: string,
  topicId: string,
  transaction: TopicMessageSubmitTransaction,
): Promise<TxEvidence> {
  const response = await transaction.execute(client);
  const receipt = await response.getReceipt(client);
  assertStatus(receipt, label);
  return {
    label,
    transactionId: response.transactionId.toString(),
    mirrorTransactionId: toMirrorTransactionId(
      response.transactionId.toString(),
    ),
    transactionHashscanUrl: hashscanTransactionUrl(
      network,
      response.transactionId.toString(),
    ),
    mirrorTransactionUrl: mirrorTransactionUrl(
      network,
      response.transactionId.toString(),
    ),
    hashscanUrl: `https://hashscan.io/${network}/topic/${topicId}`,
    topicId,
    sequenceNumber: receipt.topicSequenceNumber?.toNumber(),
  };
}

function assertStatus(receipt: TransactionReceipt, label: string) {
  const status = receipt.status.toString();
  if (status !== "SUCCESS")
    throw new Error(`${label} failed with status ${status}.`);
}

function parseNetwork(value: string): Network {
  if (value === "mainnet" || value === "testnet" || value === "previewnet")
    return value;
  throw new Error(`Unsupported HEDERA_NETWORK "${value}".`);
}

function assertDemoNetwork(network: Network): void {
  if (network === "testnet") return;
  if (process.env.ALLOW_NON_TESTNET_DEMO === "true") return;
  throw new Error(
    `Refusing to run the HCS-10 demo on ${network}. Set HEDERA_NETWORK=testnet, or set ALLOW_NON_TESTNET_DEMO=true if you really intend to spend on another network.`,
  );
}

function requireFirstEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }

  throw new Error(
    `${keys.join(" or ")} is required. Copy .env.example to .env and use a funded testnet account.`,
  );
}

function parsePrivateKey(value: string): PrivateKey {
  const parsers = [
    () => PrivateKey.fromStringECDSA(value),
    () => PrivateKey.fromStringED25519(value),
    () => PrivateKey.fromStringDer(value),
    () => PrivateKey.fromString(value),
  ];

  for (const parse of parsers) {
    try {
      return parse();
    } catch {
      // Try the next Hedera-supported key format.
    }
  }

  throw new Error(
    "HEDERA_PRIVATE_KEY could not be parsed as an ECDSA, ED25519, DER, or SDK private key.",
  );
}

function toMirrorTransactionId(transactionId: string): string {
  const [accountId, timestamp] = transactionId.split("@");
  if (!accountId || !timestamp) return transactionId;
  return `${accountId}-${timestamp.replace(".", "-")}`;
}

function hashscanTransactionUrl(
  network: Network,
  transactionId: string,
): string {
  return `https://hashscan.io/${network}/transaction/${toMirrorTransactionId(transactionId)}`;
}

function mirrorTransactionUrl(network: Network, transactionId: string): string {
  return `${getMirrorBase(network)}/api/v1/transactions/${toMirrorTransactionId(transactionId)}`;
}

function mirrorTopicMessagesUrl(network: Network, topicId: string): string {
  return `${getMirrorBase(network)}/api/v1/topics/${topicId}/messages?limit=10&order=asc`;
}

function getMirrorBase(network: Network): string {
  if (network === "mainnet") return "https://mainnet.mirrornode.hedera.com";
  if (network === "previewnet")
    return "https://previewnet.mirrornode.hedera.com";
  return "https://testnet.mirrornode.hedera.com";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
