import type { ContentType, DecodeResult, DecodedPayload, Detector } from "./types.js";
import { HeuristicDetector } from "./detector.js";
import { tryStructuralMatch } from "./schemas.js";

export * from "./types.js";

const structuralDetector: Detector = {
  name: "structural",
  detect(payload) {
    if (payload.json === null) return null;
    return tryStructuralMatch(payload.json);
  }
};

const fallbackDetector: Detector = {
  name: "fallback",
  detect(payload) {
    if (payload.text === null) {
      return {
        standard: "BINARY",
        label: "Binary",
        summary: "binary payload",
        confidence: "low",
        matchKind: "fallback",
        extractedFields: {},
        explanation: "Payload could not be decoded as UTF-8 text.",
        warnings: []
      };
    }
    if (payload.json === null) {
      return {
        standard: "UNKNOWN",
        label: "Plain text",
        summary: payload.text.slice(0, 96),
        confidence: "low",
        matchKind: "fallback",
        extractedFields: {},
        explanation: "Payload is readable text, but it is not JSON and did not match a known HCS detector.",
        warnings: []
      };
    }
    const obj = payload.json as Record<string, unknown>;
    const typeHint = String(obj.type ?? obj.p ?? "");
    return {
      standard: "CUSTOM_JSON",
      label: typeHint ? `JSON (${typeHint})` : "JSON",
      summary: summarizeJson(obj),
      confidence: "low",
      matchKind: "fallback",
      extractedFields: {},
      explanation: "Payload is JSON, but it did not match the built-in standard detectors.",
      warnings: []
    };
  }
};

const pipeline: Detector[] = [structuralDetector, new HeuristicDetector(), fallbackDetector];

export function decodePayload(base64: string): DecodeResult {
  const payload = normalizePayload(base64);
  const contentType = getContentType(payload);

  for (const detector of pipeline) {
    const match = detector.detect(payload);
    if (!match) continue;
    return {
      ...match,
      contentType,
      rawBase64: base64,
      decodedText: payload.text ?? "(binary)",
      parsed: payload.json,
      detectedBy: detector.name
    };
  }

  throw new Error("Decode pipeline exhausted without fallback match.");
}

function normalizePayload(base64: string): DecodedPayload {
  const bytes = Buffer.from(base64, "base64");
  let text: string | null = bytes.toString("utf8");
  const replacements = (text.match(/\uFFFD/g) ?? []).length;
  if (text.length > 0 && replacements / text.length > 0.05) text = null;

  let json: unknown | null = null;
  if (text !== null) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return { base64, bytes, text, json };
}

function getContentType(payload: DecodedPayload): ContentType {
  if (payload.text === null) return "binary";
  if (payload.json !== null) return "json";
  return "text";
}

function summarizeJson(obj: Record<string, unknown>): string {
  const fields = ["type", "p", "op", "id", "account_id", "operator_id"];
  const parts = fields.filter(field => obj[field] !== undefined).map(field => `${field}=${String(obj[field]).slice(0, 32)}`);
  return parts.join(" ") || JSON.stringify(obj).slice(0, 96);
}
