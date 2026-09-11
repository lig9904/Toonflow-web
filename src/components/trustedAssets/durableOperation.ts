/** Keeps the first mutation request distinct from read-only receipt recovery. */
export interface DurableOperationState<Input, Receipt> {
  input: Input; idempotencyKey: string; signature: string; receipt?: Receipt;
  phase: "submitting" | "tracking" | "uncertain" | "terminal"; error: string;
}
export function createDurableOperationController<Input extends object, Receipt>(options: {
  states: Record<string, DurableOperationState<Input, Receipt>>;
  start: (input: Input & { idempotencyKey: string }) => Promise<Receipt>;
  read: (input: Input, lookup: { idempotencyKey: string; receipt?: Receipt }) => Promise<Receipt>;
  isTerminal: (receipt: Receipt) => boolean;
  isRejected?: (error: unknown) => boolean;
  makeId?: () => string;
}) {
  const flights = new Map<string, Promise<void>>();
  const makeId = options.makeId ?? (() => `trusted-upload:${crypto.randomUUID()}`);
  function apply(state: DurableOperationState<Input, Receipt>, receipt: Receipt) { state.receipt = receipt; state.phase = options.isTerminal(receipt) ? "terminal" : "tracking"; state.error = ""; }
  async function refresh(key: string): Promise<void> {
    if (flights.has(key)) return flights.get(key);
    const state = options.states[key]; if (!state) return;
    const flight = (async () => {
      try { const receipt = await options.read(state.input, { idempotencyKey: state.idempotencyKey, receipt: state.receipt }); if (options.states[key] === state) apply(state, receipt); }
      catch (error) { if (options.states[key] === state) { state.phase = "uncertain"; state.error = (error as Error)?.message || "尚不能确认服务端任务状态；请查询回执，不会重复提交上传。"; } }
    })();
    flights.set(key, flight); try { await flight; } finally { flights.delete(key); }
  }
  async function begin(key: string, input: Input): Promise<void> {
    if (flights.has(key)) return flights.get(key);
    const current = options.states[key]; const signature = JSON.stringify(input);
    if (current && (current.phase !== "terminal" || current.signature === signature)) return refresh(key);
    options.states[key] = { input: structuredClone(input), idempotencyKey: makeId(), signature, phase: "submitting", error: "" };
    const state = options.states[key];
    const flight = (async () => {
      try { const receipt = await options.start({ ...state.input, idempotencyKey: state.idempotencyKey }); if (options.states[key] === state) apply(state, receipt); }
      catch (error) { if (options.states[key] === state) { state.phase = options.isRejected?.(error) ? "terminal" : "uncertain"; state.error = (error as Error)?.message || "提交回执暂未确认，请查询任务。不会自动重复上传。"; } }
    })();
    flights.set(key, flight); try { await flight; } finally { flights.delete(key); }
  }
  function adopt(key: string, input: Input, idempotencyKey: string, receipt: Receipt) {
    if (flights.has(key)) return;
    const existing = options.states[key];
    if (existing && existing.idempotencyKey !== idempotencyKey && existing.phase !== "terminal") return;
    options.states[key] = { input: structuredClone(input), idempotencyKey, signature: JSON.stringify(input), receipt, phase: options.isTerminal(receipt) ? "terminal" : "tracking", error: "" };
  }
  function forgetTerminal(key: string) { if (!flights.has(key) && options.states[key]?.phase === "terminal") delete options.states[key]; }
  return { begin, refresh, adopt, forgetTerminal, busy: (key: string) => flights.has(key) };
}
