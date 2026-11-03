const { writeFileSync } = require("fs");
const zlib = require("zlib");

function makeCrcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
}
const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff);
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeB, data])) >>> 0, 0);
  return Buffer.concat([len, typeB, data, crcBuf]);
}

function makePNG(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // RGB

  const row = Buffer.alloc(1 + size * 3);
  row[0] = 0;
  for (let i = 0; i < size; i++) {
    row[1 + i * 3 + 0] = 34;
    row[1 + i * 3 + 1] = 197;
    row[1 + i * 3 + 2] = 94;
  }
  const rows = Buffer.concat(Array(size).fill(row));
  const compressed = zlib.deflateSync(rows);

  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdrData),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const dir = require("path").join(__dirname, "..", "public", "icons");
writeFileSync(dir + "/icon16.png", makePNG(16));
writeFileSync(dir + "/icon48.png", makePNG(48));
writeFileSync(dir + "/icon128.png", makePNG(128));
console.log("Icons created");
