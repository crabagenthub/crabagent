/** 与 Collector `POST /v1/opik/batch` 体一致（见 services/collector/src/opik-batch-ingest.ts）。 */
export type OpikBatchPayload = {
  threads?: Record<string, unknown>[];
  traces?: Record<string, unknown>[];
  spans?: Record<string, unknown>[];
  attachments?: Record<string, unknown>[];
  feedback?: Record<string, unknown>[];
  envelope_json?: unknown;
};
