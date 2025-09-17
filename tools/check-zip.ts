// tools/check-zip.ts
import { readFile } from "node:fs/promises";
const path = process.argv[2];
if (!path) {
  console.error("Usage: npx tsx tools/check-zip.ts <path-to-file.mxl>");
  process.exit(1);
}

(async () => {
  const buf = await readFile(path);
  const len = buf.length;
  const head = buf.subarray(0, 4).toString("hex"); // should be 504b0304
  const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]); // 'PK\x05\x06'
  const minEOCD = 22; // min length
  const start = Math.max(0, len - (minEOCD + 0xffff)); // EOCD is within last 64K+22
  const idx = buf.indexOf(EOCD, start);

  let ok = false, missing = 0, commentLen = 0;
  if (idx >= 0) {
    // comment length is last 2 bytes of EOCD
    commentLen = buf.readUInt16LE(idx + 20);
    const expectedEnd = idx + minEOCD + commentLen;
    if (expectedEnd <= len) {
      ok = true;
      if (expectedEnd < len) {
        // trailing junk (fine but unusual)
      } else if (expectedEnd > len) {
        missing = expectedEnd - len;
        ok = false;
      }
    }
  }

  console.log({
    path,
    bytes: len,
    head_hex: head,
    eocd_found: idx >= 0,
    eocd_offset: idx,
    comment_len: commentLen,
    zip_ok: ok,
    missing_bytes: missing
  });
})();
