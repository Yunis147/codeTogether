import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
vi.mock('./env.js', () => ({ env: { JUDGE0_URL: 'https://onlinecompiler.io/api', JUDGE0_AUTH_TOKEN: 'test-token' } }));
import { executeProject, quoteForShell } from './judge0.js';
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const project = { entryPath: 'main.py', entrySource: 'print(1)', files: [{ path: 'main.py', content: 'print(1)' }], stdin: '' };
describe('cloud runner compatibility', () => {
  it.each([['python', 113], ['javascript', 102], ['typescript', 101], ['c', 103], ['cpp', 105], ['java', 91]] as const)(
    'preserves the OnlineCompiler language ID for %s', async (language, id) => {
      fetchMock.mockResolvedValue(Response.json({ status: { id: 3, description: 'Accepted' }, stdout: '1' }));
      await executeProject({ ...project, language });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.language_id).toBe(id); expect(body.additional_files).toBeTruthy();
    },
  );
  it('retains the token when a poll response omits it', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(Response.json({ token: 'submission-1', status: { id: 1 } }))
      .mockResolvedValueOnce(Response.json({ status: { id: 2 } }))
      .mockResolvedValueOnce(Response.json({ status: { id: 3 }, stdout: 'done' }));
    const result = executeProject({ ...project, language: 'python' });
    await vi.advanceTimersByTimeAsync(2400);
    expect((await result).stdout).toBe('done');
    expect(fetchMock.mock.calls[2][0]).toContain('/submissions/submission-1?');
  });
  it('returns a recoverable token after the initial polling window', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(Response.json({ token: 'pending-1', status: { id: 2, description: 'Processing' } }));
    const result = executeProject({ ...project, language: 'python' });
    await vi.advanceTimersByTimeAsync(16000);
    expect(await result).toMatchObject({ token: 'pending-1', status: { id: 2 } });
  });
  it('quotes apostrophes as a single shell argument', () => {
    const result = spawnSync('bash', ['-c', `printf '%s' ${quoteForShell("Bob's.py")}`], { encoding: 'utf8' });
    expect(result.status).toBe(0); expect(result.stdout).toBe("Bob's.py");
  });
});
