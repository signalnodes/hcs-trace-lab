# HCS Trace Lab

HCS Trace Lab is a Scaffold-HBAR template for debugging HCS-10 agent communication on Hedera. It gives developers a Next.js inspector, a reusable HCS Trace decoder, and a credentialed demo script that creates a real HCS-10 exchange on testnet through the Hashgraph Online Standards SDK.

The read-only inspector runs without credentials. Testnet writes are isolated to the local demo script.

## Quickstart

```bash
npx create-scaffold-hbar@latest <your-project-name> --template signalnodes/hcs-trace-lab
cd <your-project-name>
npm run dev
```

Open `http://localhost:3000`.

The scaffold command installs dependencies by default. If you pass `--skip-install`, run:

```bash
npm install
```

## Verify

```bash
npm run lint
npm run build
npm run test
```

## Credential-Free Inspection

The inspector uses public Hedera mirror node APIs. It does not need an account, private key, wallet, or backend database.

Set these optional defaults in `.env`:

```bash
NEXT_PUBLIC_DEFAULT_NETWORK=testnet
NEXT_PUBLIC_DEFAULT_TOPIC_ID=0.0.10862287
```

The app falls back to testnet topic `0.0.10862287` when no topic is configured. The scaffold CLI regenerates `.env.example` with blank values, so this fallback is in application code rather than in the generated env file. You can replace it with any public HCS topic ID.

## HCS-10 Demo

Create a local `.env`:

```bash
cp .env.example .env
```

Fill:

```bash
HEDERA_NETWORK=testnet
HEDERA_ACCOUNT_ID=0.0.YOUR_ACCOUNT
HEDERA_PRIVATE_KEY=YOUR_PRIVATE_KEY
```

Use a funded Hedera testnet account. `HEDERA_NETWORK` may also be left blank; the demo defaults blank values to `testnet`. Then run:

```bash
npm run demo:hcs10
```

The script uses `@hashgraphonline/standards-sdk` HCS-10 transaction builders to:

- create Alice inbound and outbound HCS-10 topics
- create Bob inbound and outbound HCS-10 topics
- submit a connection request
- create a connection topic
- confirm the connection
- exchange two HCS-10 messages
- print Hashscan links and write `packages/hardhat/demo-output/hcs10-last-run.json`

The demo models Alice and Bob with separate HCS-10 inbound and outbound topics under one funded operator account. This keeps the walkthrough faucet-friendly while still creating real HCS topics, requests, confirmations, and messages.

After the run, set:

```bash
NEXT_PUBLIC_DEFAULT_TOPIC_ID=0.0.CONNECTION_TOPIC_FROM_OUTPUT
```

Then restart the app and inspect the generated connection topic.

## Evidence

This repository intentionally does not include private credentials or invented transaction evidence.

Latest verified testnet run:

- Network: `testnet`
- Operator account: `0.0.8009862`
- Alice inbound topic: `0.0.10862283`
- Alice outbound topic: `0.0.10862284`
- Bob inbound topic: `0.0.10862285`
- Bob outbound topic: `0.0.10862286`
- Connection topic: `0.0.10862287`
- Connection topic Hashscan: `https://hashscan.io/testnet/topic/0.0.10862287`
- Bob inbound Hashscan: `https://hashscan.io/testnet/topic/0.0.10862285`
- Verified transaction ID: `0.0.8009862-1791147652-837118691`
- Transaction mirror evidence: `https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.8009862-1791147652-837118691`

Mirror node checks:

```bash
curl "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10862287/messages?limit=10&order=asc"
curl "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10862285/messages?limit=10&order=asc"
```

Observed evidence:

- Connection topic `0.0.10862287` has two HCS-10 `message` operations.
- Bob inbound topic `0.0.10862285` has `connection_request` and `connection_created` operations.
- Transaction `0.0.8009862-1791147652-837118691` is `CONSENSUSSUBMITMESSAGE` with result `SUCCESS` for entity `0.0.10862287`.
- The demo output was written locally to `packages/hardhat/demo-output/hcs10-last-run.json`.

## Architecture

- The decoder is adapted from the MIT-licensed `signalnodes/hcs-trace` CLI and packaged here as a reusable library for Scaffold-HBAR apps.
- `packages/hcs-trace-core` contains mirror reads, bounded pagination, retry/backoff, timeouts, decoding, and classification.
- `packages/nextjs` provides the inspector UI and `/api/topic`, which keeps mirror reads server-side.
- `packages/hardhat` satisfies the Hardhat framework requirement and contains the HOL SDK demo script.

## Detection Labels

The inspector uses honest labels:

- `structural_match`: a minimal known message shape matched.
- `heuristic_match`: recognizable fields were present, but strict shape checks did not pass.
- `fallback`: readable text, custom JSON, binary data, or unknown content.

These labels do not prove signer identity, account ownership, or complete protocol compliance.

## Extending Decoders

Add a detector in `packages/hcs-trace-core/src/decode/`, include a focused fixture in `packages/hcs-trace-core/tests/`, then run:

```bash
npm run test -w @hcs-trace-lab/core
```

Keep extracted fields small and useful for inspection.

## Troubleshooting

- `Topic or message page not found`: confirm the network and topic ID.
- Empty topic after creation: wait for mirror node indexing and refresh.
- Demo fails with insufficient balance: fund the testnet account from the Hedera Portal faucet.
- Demo fails on private key parsing: use the key format exported by the Hedera Portal or SDK account tooling.
- Build fails in Hardhat on first run: retry with network access so Hardhat can fetch the configured Solidity compiler.

## Bounty Checklist

- MIT license
- `template.json`
- `README.md`
- `AGENTS.md`
- npm workspace layout
- `packages/nextjs`
- `packages/hardhat`
- Node `>=20.18.3`
- clean install, lint, build, and tests
- genuine HCS testnet usage through HOL SDK builders
- verified testnet evidence documented above
