import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

/**
 * This mirrors an offline provider: both clients begin from the same state,
 * make edits while no updates are exchanged, then send their full missing
 * state when their connection resumes. The key property is convergence rather
 * than the order that concurrent insertions happen to render in.
 */
describe('offline Yjs edits', () => {
  it('merge on reconnect without losing either client’s change', () => {
    const first = new Y.Doc();
    const second = new Y.Doc();

    const firstText = first.getText('monaco');
    firstText.insert(0, 'base');
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    // Both documents are offline from here until the two updates below.
    firstText.insert(0, 'first ');
    second.getText('monaco').insert(4, ' second');

    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));

    expect(firstText.toString()).toBe(second.getText('monaco').toString());
    expect(firstText.toString()).toContain('first');
    expect(firstText.toString()).toContain('second');
    expect(firstText.toString()).toContain('base');
  });
});
