// Next.js already supplies Sharp. Keep every shortcut icon derived from the same vector master.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const svg = await readFile(new URL('src/app/icon.svg', root), 'utf8');
const fullBleedSvg = svg.replace('rx="112"', 'rx="0"');
const icons = new URL('public/icons/', root);
await mkdir(icons, { recursive: true });

for (const size of [192, 512]) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(`speakbetter-${size}.png`, icons)));
}

// Maskable icons and Apple touch icons let the operating system supply the outside shape.
const maskable = await sharp(Buffer.from(fullBleedSvg)).resize(512, 512).png().toBuffer();
await writeFile(new URL('speakbetter-maskable-512.png', icons), maskable);
await writeFile(
  new URL('src/app/apple-icon.png', root),
  await sharp(Buffer.from(fullBleedSvg)).resize(180, 180).png().toBuffer(),
);

// ICO supports embedded PNG images, so browsers can choose the appropriate tab/shortcut size.
const sizes = [16, 32, 48];
const images = await Promise.all(
  sizes.map((size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  header[entry] = size;
  header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await writeFile(new URL('src/app/favicon.ico', root), Buffer.concat([header, ...images]));
console.log('Generated SpeakBetter shortcut, maskable, Apple, and browser icons.');
