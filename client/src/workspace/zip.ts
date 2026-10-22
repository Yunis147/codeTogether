/**
 * A minimal ZIP reader for project import. The browser supplies the hard part
 * (`DecompressionStream('deflate-raw')`), so this only has to walk the central
 * directory and pull out each entry.
 *
 * Reading the sizes from the central directory rather than the local headers
 * means archives written with data descriptors — where the local header's sizes
 * are zero — still work.
 */
export type ZipTextEntry = { path: string; content: string };

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

export const MAX_IMPORT_FILES = 200;
export const MAX_IMPORT_FILE_BYTES = 1024 * 1024;

export class ZipError extends Error {}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes as unknown as BodyInit).body;
  if (!stream) throw new ZipError('Could not read zip entry.');
  const inflated = stream.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(inflated).arrayBuffer());
}

function findEndOfCentralDirectory(view: DataView): number {
  // The record is 22 bytes plus an optional comment of up to 64 KiB.
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff);

  for (let offset = view.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset;
  }

  throw new ZipError('That file does not look like a zip archive.');
}

const PRESERVED_ROOT_FOLDERS = new Set([
  'src',
  'lib',
  'app',
  'com',
  'org',
  'net',
  'java',
  'python',
  'client',
  'server',
  'test',
  'tests',
  'public',
  'packages',
]);

/**
 * Strips an archive-level wrapper folder (e.g. `my-repo-main/`), while preserving
 * standard project packages and source directories like `src/` or `com/`.
 */
function stripCommonPrefix(paths: string[], archiveName?: string): string[] {
  if (paths.length === 0) return paths;

  const first = paths[0].split('/')[0];
  if (PRESERVED_ROOT_FOLDERS.has(first.toLowerCase())) {
    return paths;
  }

  const shared = paths.every((path) => path.split('/').length > 1 && path.startsWith(`${first}/`));
  if (!shared) return paths;

  const baseArchive = archiveName?.replace(/\.zip$/i, '');
  const isWrapper =
    !baseArchive ||
    first === baseArchive ||
    first.endsWith('-main') ||
    first.endsWith('-master') ||
    paths.some((p) => p.split('/').length > 2);

  return isWrapper ? paths.map((path) => path.slice(first.length + 1)) : paths;
}

function isSafePath(path: string): boolean {
  if (path.startsWith('/') || path.includes('\\')) return false;
  return !path.split('/').some((segment) => segment === '..' || segment === '.' || segment === '');
}

export async function readZip(file: File): Promise<ZipTextEntry[]> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const end = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const raw: { path: string; content: string }[] = [];
  let skippedForSize = 0;
  let skippedBinary = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > view.byteLength) break;
    if (view.getUint32(cursor, true) !== CENTRAL_FILE_HEADER) break;

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);

    const path = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;

    // Directories are implied by the file paths, so they are skipped here and
    // recreated as folders on the way in.
    if (path.endsWith('/') || !isSafePath(path)) continue;

    if (uncompressedSize > MAX_IMPORT_FILE_BYTES) {
      skippedForSize += 1;
      continue;
    }

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

    let content: Uint8Array;
    if (method === METHOD_STORE) {
      content = compressed;
    } else if (method === METHOD_DEFLATE) {
      content = await inflateRaw(compressed);
    } else {
      continue;
    }

    // A NUL byte means this is not source code; importing it as text would
    // corrupt it, so it is left out rather than mangled.
    if (content.includes(0)) {
      skippedBinary += 1;
      continue;
    }

    raw.push({ path, content: decoder.decode(content) });
  }

  if (raw.length === 0) {
    const reason =
      skippedForSize + skippedBinary > 0
        ? 'Every file in that archive was binary or too large to import.'
        : 'That archive has no text files to import.';
    throw new ZipError(reason);
  }

  const paths = stripCommonPrefix(
    raw.map((entry) => entry.path),
    file.name,
  );

  return raw
    .map((entry, index) => ({ path: paths[index], content: entry.content }))
    .filter((entry) => entry.path.length > 0)
    .slice(0, MAX_IMPORT_FILES);
}
