import { closeSync, createReadStream, fstatSync, openSync, readSync } from 'node:fs';
import { createZstdDecompress } from 'node:zlib';

/**
 * Lines of a zstd-compressed text file. The Lichess dump is in pzstd format: every zstd frame is preceded by a
 * skippable frame (magic 0x184D2A50) holding the compressed size of the next frame, which Node's decoder rejects —
 * so frames are located by hand and decompressed one by one. Plain single-frame files work too.
 */
export async function* zstdLines(path: string): AsyncGenerator<string> {
  const fd = openSync(path, 'r');
  const size = fstatSync(fd).size;
  const head = Buffer.alloc(12);
  const frames: [number, number][] = [];
  let at = 0;
  while (at + 12 <= size) {
    readSync(fd, head, 0, 12, at);
    if (head.readUInt32LE(0) !== 0x184d2a50 || head.readUInt32LE(4) !== 4) break;
    const len = head.readUInt32LE(8);
    frames.push([at + 12, at + 12 + len - 1]);
    at += 12 + len;
  }
  closeSync(fd);
  if (!frames.length) frames.push([0, size - 1]);
  let rest = '';
  for (const [start, end] of frames) {
    const stream = createReadStream(path, { start, end }).pipe(createZstdDecompress());
    for await (const chunk of stream) {
      const text = rest + (chunk as Buffer).toString('utf8');
      const lines = text.split('\n');
      rest = lines.pop()!;
      for (const l of lines) yield l.replace(/\r$/, '');
    }
  }
  if (rest) yield rest;
}
