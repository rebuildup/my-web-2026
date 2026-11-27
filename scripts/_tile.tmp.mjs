import sharp from 'sharp';
import { readdirSync } from 'node:fs';
// usage: node scripts/_tile.tmp.mjs <srcPng...> --out=<dir> [--width=1150] [--tile=1500]
const args = process.argv.slice(2);
const out = args.find(a=>a.startsWith('--out='))?.slice(6) ?? '.tmp/tiles';
const width = Number(args.find(a=>a.startsWith('--width='))?.slice(8) ?? 1150);
const tileH = Number(args.find(a=>a.startsWith('--tile='))?.slice(7) ?? 1500);
const srcs = args.filter(a=>!a.startsWith('--'));
const { mkdirSync } = await import('node:fs');
mkdirSync(out, { recursive: true });
for (const src of srcs) {
  const name = src.split('/').pop().replace(/\.png$/, '');
  const img = sharp(src);
  const meta = await img.metadata();
  const scale = width / meta.width;
  const resized = await img.resize({ width }).png().toBuffer();
  const rmeta = await sharp(resized).metadata();
  const tiles = Math.ceil(rmeta.height / tileH);
  for (let i = 0; i < tiles; i++) {
    const top = i * tileH;
    const h = Math.min(tileH, rmeta.height - top);
    await sharp(resized).extract({ left: 0, top, width, height: h }).png()
      .toFile(`${out}/${name}-t${String(i).padStart(2,'0')}.png`);
  }
  console.log(`${name}: ${tiles} tiles (${rmeta.width}x${rmeta.height})`);
}
