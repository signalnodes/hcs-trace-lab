# HCS Trace Lab Agent Guide

## Package Responsibilities

- `packages/hcs-trace-core`: read-only mirror node access, topic normalization, payload decoding, and tests for classification semantics.
- `packages/nextjs`: browser inspector and server-side API routes. Private keys must never be imported, read, or exposed here.
- `packages/hardhat`: credentialed testnet scripts (the HOL HCS-10 demo) and the project's Solidity compile/test surface. This is the only package that may read `HEDERA_*` credentials.

## Commands

- `npm install`: install all workspaces.
- `npm run dev`: start the inspector at `http://localhost:3000`.
- `npm run lint`: run workspace static checks.
- `npm run build`: build the core package, compile Hardhat, and build Next.js.
- `npm run test`: run core tests and Hardhat tests.
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
- HCS-10 flow checks in `packages/hcs-trace-core/src/hcs10/flow.ts` are cross-message consistency checks. Keep pass/warn/fail/info semantics honest and never present them as identity verification.
- Keep this distinction visible in UI copy, docs, and tests.

## Scope

- Keep the template focused on HCS-10 topic creation, message exchange, mirror inspection, decoding, export, and evidence.
- Defer login, databases, chat assistants, broad dashboards, and unrelated Hedera services unless the template goal changes.
- Prefer small tests that protect decoder behavior, mirror error handling, and scaffold health.

## Working In This Repo

Start of a task:

1. Read this file and the README section for the area you are changing.
2. Decide which package owns the change by using the responsibilities above. Do not move mirror or decoding logic into `packages/nextjs`.
3. Look at the nearest existing tests. Fixtures in `packages/hcs-trace-core/tests/fixtures/` are real testnet mirror responses, so prefer extending them over inventing message shapes.

Where common changes go:

- New or stricter standard detection: `packages/hcs-trace-core/src/decode/schemas.ts` (structural) or `detector.ts` (heuristic), with tests in `tests/decode.test.ts`.
- New HCS-10 consistency check: `packages/hcs-trace-core/src/hcs10/flow.ts`, with tests in `tests/hcs10.test.ts`. Give it a stable `id` and use `pass`/`warn`/`fail`/`info` honestly.
- Mirror behavior (limits, retries, pagination): `packages/hcs-trace-core/src/mirror/index.ts`, with tests in `tests/mirror.test.ts`.
- UI: `packages/nextjs/app/page.tsx` (inspector) and `packages/nextjs/app/trace/` (tracer). API routes stay thin and call `@hcs-trace-lab/core`.
- Testnet write flows: new scripts in `packages/hardhat/scripts/`. Keep the testnet-only guard and write non-secret evidence to `demo-output/`.

A change is done when:

- `npm run lint && npm run build && npm run test` passes from the repo root.
- No credential, `.env` file or `demo-output/` file is staged.
- Any new UI or docs wording keeps detection and consistency checks separate from identity claims.
- Transaction or topic evidence in the README comes only from a real run, never from invented IDs.
