export type DetectionSource = "structural" | "heuristic" | "fallback";
export type DetectionConfidence = "high" | "medium" | "low";
export type ContentType = "json" | "text" | "binary" | "unknown";

export type HcsStandard =
  | "HCS-1"
  | "HCS-2"
  | "HCS-3"
  | "HCS-5"
  | "HCS-6"
  | "HCS-7"
  | "HCS-10"
  | "HCS-11"
  | "HCS-20"
  | "HCS-27"
  | "CUSTOM_JSON"
  | "BINARY"
  | "UNKNOWN";

export interface DecodeResult {
  standard: HcsStandard;
  label: string;
  contentType: ContentType;
  rawBase64: string;
  decodedText: string;
  parsed: unknown;
  summary: string;
  detectedBy: DetectionSource;
  confidence: DetectionConfidence;
  matchKind: "structural_match" | "heuristic_match" | "fallback";
  extractedFields: Record<string, unknown>;
  explanation: string;
  warnings: string[];
}

export interface DecodedPayload {
  base64: string;
  bytes: Uint8Array;
  text: string | null;
  json: unknown | null;
}

export interface DetectorMatch {
  standard: HcsStandard;
  label: string;
  summary: string;
  confidence: DetectionConfidence;
  matchKind: DecodeResult["matchKind"];
  extractedFields: Record<string, unknown>;
  explanation: string;
  warnings: string[];
}

export interface Detector {
  name: DetectionSource;
  detect(payload: DecodedPayload): DetectorMatch | null;
}
