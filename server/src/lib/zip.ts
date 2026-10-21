import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A minimal ZIP writer. Export reads plain text straight out of Postgres, so
 * the only thing needed here is writing a well-formed archive: no ZIP64, no
 * encryption, no streaming. Node's zlib supplies both deflate and CRC-32.
 *
 * Reading archives happens in the browser on import, where the native
 * `DecompressionStream` does the same job, so there is no reader here.
 */
export type ZipEntry = {
  /** Forward-slash separated path. A trailing slash marks a directory. */
  path: string;
  content?: string | Buffer;
  /** Unix mode stored in the archive. Scripts need the executable bit for Judge0. */
  mode?: number;
};

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

const VERSION = 20;
// The high byte identifies Unix as the originating system, which makes the
// executable bits on Judge0's generated compile/run scripts meaningful.
const VERSION_MADE_BY_UNIX = (3 << 8) | VERSION;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Unix mode in the high 16 bits; the low 0x10 bit is the MS-DOS directory flag. */
const MODE_DIRECTORY = (0o040755 << 16) | 0x10;

function dosTimestamp(when: Date): { time: number; date: number } {
  const time =
    ((when.getHours() & 0x1f) << 11) |
    ((when.getMinutes() & 0x3f) << 5) |
    (Math.floor(when.getSeconds() / 2) & 0x1f);

  // The DOS date epoch is 1980; anything earlier cannot be represented.
  const year = Math.max(when.getFullYear() - 1980, 0);
  const date = ((year & 0x7f) << 9) | (((when.getMonth() + 1) & 0x0f) << 5) | (when.getDate() & 0x1f);

  return { time, date };
}

export function createZip(entries: ZipEntry[], now = new Date()): Buffer {
  const { time, date } = dosTimestamp(now);
  const records: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const isDirectory = entry.path.endsWith('/');
    const name = Buffer.from(entry.path, 'utf8');

    const raw = isDirectory
      ? Buffer.alloc(0)
      : Buffer.isBuffer(entry.content)
        ? entry.content
        : Buffer.from(entry.content ?? '', 'utf8');

    const deflated = raw.length > 0 ? deflateRawSync(raw) : Buffer.alloc(0);
    // Tiny or incompressible files get larger when deflated, so store those.
    const compress = raw.length > 0 && deflated.length < raw.length;
    const body = compress ? deflated : raw;
    const method = compress ? METHOD_DEFLATE : METHOD_STORE;
    const checksum = raw.length > 0 ? crc32(raw) : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(0, 6); // flags: sizes are known up front, so no data descriptor
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    records.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_FILE_HEADER, 0);
    central.writeUInt16LE(VERSION_MADE_BY_UNIX, 4); // version made by (Unix)
    central.writeUInt16LE(VERSION, 6); // version needed to extract
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number where the file starts
    central.writeUInt16LE(0, 36); // internal attributes
    // Bitwise shifts in JavaScript return signed 32-bit integers. Regular
    // Unix file modes set bit 31 here, so multiply to retain the unsigned ZIP
    // external-attributes value expected by Buffer.writeUInt32LE.
    central.writeUInt32LE(
      isDirectory ? MODE_DIRECTORY : (entry.mode ?? 0o100644) * 0x1_0000,
      38,
    );
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralDirectory = Buffer.concat(directory);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk holding the central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...records, centralDirectory, end]);
}
