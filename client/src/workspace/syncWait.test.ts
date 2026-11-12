import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSync } from './syncWait';
afterEach(() => vi.useRealTimers());
describe('import acknowledgement waits', () => {
  it('rejects rather than reports success when acknowledgement times out', async () => {
    vi.useFakeTimers();
    const wait = waitForSync(new Promise(() => {}), 'delivery pending', 5000);
    const result = expect(wait).rejects.toThrow('delivery pending');
    await vi.advanceTimersByTimeAsync(5000); await result;
  });
  it('clears the timeout after acknowledgement', async () => {
    vi.useFakeTimers(); await waitForSync(Promise.resolve(), 'timeout');
    expect(vi.getTimerCount()).toBe(0);
  });
});
