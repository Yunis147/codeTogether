import { describe, expect, it } from 'vitest';
import { createZip } from '../../../server/src/lib/zip';
import { readZip } from './zip';
function archive(bytes: Buffer): File {
  return { name: 'project.zip', size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer } as File;
}
describe('bounded project import', () => {
  it('reads Unicode source paths and content', async () => {
    const zip = createZip([{ path: 'src/café.ts', content: 'console.log("hello")' }]);
    expect(await readZip(archive(zip))).toEqual([{ path: 'src/café.ts', content: 'console.log("hello")' }]);
  });
  it('rejects forged sizes while decompressing', async () => {
    const zip = createZip([{ path: 'huge.txt', content: 'A'.repeat(1024 * 1024 + 32) }]);
    const central = zip.readUInt32LE(zip.length - 6); zip.writeUInt32LE(1, central + 24);
    await expect(readZip(archive(zip))).rejects.toThrow('1 MB');
  });
  it('rejects truncated file data with a useful error', async () => {
    const zip = createZip([{ path: 'main.py', content: 'print(1)' }]);
    const central = zip.readUInt32LE(zip.length - 6); zip.writeUInt32LE(0x7fffffff, central + 20);
    await expect(readZip(archive(zip))).rejects.toThrow('incomplete');
  });
});
