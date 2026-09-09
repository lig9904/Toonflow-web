export type VendorSaveTask<T> = (vendorId: string, payload: T) => Promise<void>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createVendorSaveQueue<T>(save: VendorSaveTask<T>) {
  const tails = new Map<string, Promise<void>>();

  function enqueue(vendorId: string, payload: T): Promise<void> {
    const snapshot = clone(payload);
    const previous = tails.get(vendorId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(() => save(vendorId, clone(snapshot)));
    const tracked = task.finally(() => {
      if (tails.get(vendorId) === tracked) tails.delete(vendorId);
    });
    tails.set(vendorId, tracked);
    return tracked;
  }

  function isSaving(vendorId: string): boolean {
    return tails.has(vendorId);
  }

  return { enqueue, isSaving };
}
