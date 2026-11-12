import { describe, expect, it } from 'vitest';
import { validateHeaderValue } from 'node:http';
import { createZip, crc32 } from './zip.js';
import { downloadDisposition, zipEntriesFor } from './projectPaths.js';

describe('project archives', () => {
  it('computes the standard CRC-32 without requiring Node 22', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
  it('marks filenames as UTF-8 in both ZIP headers', () => {
    const zip = createZip([{ path: 'café.ts', content: 'hello' }]);
    const central = zip.readUInt32LE(zip.length - 6);
    expect(zip.readUInt16LE(6) & 0x800).toBe(0x800);
    expect(zip.readUInt16LE(central + 8) & 0x800).toBe(0x800);
  });
  it('gives colliding folders distinct paths and keeps their children', () => {
    const files = [
      { id: 'a', parentId: null, name: 'a:b', type: 'FOLDER', textContent: null },
      { id: 'b', parentId: null, name: 'a?b', type: 'FOLDER', textContent: null },
      { id: 'c', parentId: 'a', name: 'main.py', type: 'FILE', textContent: 'first' },
      { id: 'd', parentId: 'b', name: 'main.py', type: 'FILE', textContent: 'second' },
    ];
    const entries = zipEntriesFor(files);
    expect(new Set(entries.map((entry) => entry.path)).size).toBe(4);
    expect(entries.filter((entry) => entry.content).map((entry) => entry.content).sort()).toEqual(['first', 'second']);
  });
  it('exports Unicode room names in a valid download header', () => {
    const header = downloadDisposition('项目 café');
    expect(() => validateHeaderValue('Content-Disposition', header)).not.toThrow();
    expect(header).toContain("filename*=UTF-8''");
  });
});
