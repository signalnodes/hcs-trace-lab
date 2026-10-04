# HCS Trace Lab Agent Guide

## Package Responsibilities

- `packages/hcs-trace-core`: read-only mirror node access, topic normalization, payload decoding, and tests for classification semantics.
- `packages/nextjs`: browser inspector and server-side API routes. Private keys must never be imported, read, or exposed here.
- `packages/hardhat`: required Scaffold-HBAR framework package, local Solidity compile/test surface, and the credentialed HCS-10 demo script.

## Commands

- `npm install`: install all workspaces.
- `npm run dev`: start the inspector at `http://localhost:3000`.
- `npm run lint`: run workspace static checks.
- `npm run build`: build the core package, compile Hardhat, and build Next.js.
- `npm test`: run core tests and Hardhat tests.
- `npm run demo:hcs10`: create a real HCS-10 exchange on testnet using the HOL Standards SDK transaction builders.

## Credential Handling

- Keep `HEDERA_ACCOUNT_ID` and `HEDERA_PRIVATE_KEY` only in a local `.env`.
- Do not commit `.env`, generated account keys, or copied private keys.
- Do not ask users to paste private keys into chat, docs, issues, or pull requests.
- Browser code may read only `NEXT_PUBLIC_*` values.
- The demo script may read Hedera credentials from local `.env` and writes non-secret run evidence to `packages/hardhat/demo-output/`.

## Detection Semantics

- `structural_match` means the payload matched a minimal known shape for a standard.
- `heuristic_match` means fields looked like a known standard but did not satisfy the stricter structural detector.
- Neither label proves signer identity, account ownership, topic authority, or full protocol compliance.
- Keep this distinction visible in UI copy, docs, and tests.

## Scope

- Keep the template focused on HCS-10 topic creation, message exchange, mirror inspection, decoding, export, and evidence.
- Defer login, databases, chat assistants, broad dashboards, and unrelated Hedera services unless the template goal changes.
- Prefer small tests that protect decoder behavior, mirror error handling, and scaffold health.
