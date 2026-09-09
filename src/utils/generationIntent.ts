export interface GenerationIntent {
  key: string;
  fingerprint: string;
}

interface IntentRecord<T> {
  intent: GenerationIntent;
  promise?: Promise<T>;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const item = (value as Record<string, unknown>)[key];
        if (item !== undefined) result[key] = stableValue(item);
        return result;
      }, {});
  }
  return value;
}

export function fingerprintGenerationPayload(payload: unknown): string {
  return JSON.stringify(stableValue(payload));
}

function createKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `generation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createGenerationIntent(payload: unknown): GenerationIntent {
  return { key: createKey(), fingerprint: fingerprintGenerationPayload(payload) };
}

export function getGenerationErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  const response = value.response && typeof value.response === "object" ? (value.response as Record<string, unknown>) : undefined;
  const candidates = [value.status, response?.status];
  const status = candidates.find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
  return typeof status === "number" ? status : undefined;
}

/** Keep keys for unknown/network/409/5xx outcomes; clear them for explicit validation failures. */
export function shouldRetainGenerationIntent(error: unknown): boolean {
  const status = getGenerationErrorStatus(error);
  return status == null || status === 408 || status === 409 || status === 429 || status >= 500;
}

export function createGenerationIntentStore<T = unknown>() {
  const records = new Map<string, IntentRecord<T>>();

  function getOrCreate(scope: string, payload: unknown): GenerationIntent {
    const fingerprint = fingerprintGenerationPayload(payload);
    const current = records.get(scope);
    if (current && current.intent.fingerprint === fingerprint) return current.intent;
    const intent = createGenerationIntent(payload);
    records.set(scope, { intent });
    return intent;
  }

  function clear(scope: string, key?: string) {
    const current = records.get(scope);
    if (!current || (key && current.intent.key !== key) || current.promise) return;
    records.delete(scope);
  }

  function markSuccess(scope: string, key: string) {
    const current = records.get(scope);
    if (current?.intent.key === key && !current.promise) records.delete(scope);
  }

  function run(scope: string, payload: unknown, operation: (key: string) => Promise<T>): Promise<T> {
    const intent = getOrCreate(scope, payload);
    const current = records.get(scope);
    if (current?.promise && current.intent.key === intent.key) return current.promise;

    const promise = operation(intent.key).then(
      (value) => {
        const record = records.get(scope);
        if (record?.intent.key === intent.key) {
          records.delete(scope);
        }
        return value;
      },
      (error) => {
        const record = records.get(scope);
        if (record?.intent.key === intent.key) {
          record.promise = undefined;
          if (!shouldRetainGenerationIntent(error)) records.delete(scope);
        }
        throw error;
      },
    );
    records.set(scope, { intent, promise });
    return promise;
  }

  return { getOrCreate, clear, markSuccess, run };
}
