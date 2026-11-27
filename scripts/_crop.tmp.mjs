import sharp from 'sharp';
const [,, src, outPrefix, w, h, step] = process.argv;
const img = sharp(src);
const meta = await img.metadata();
const W = Number(w), H = Number(h), STEP = Number(step);
let i = 0;
for (let y = 0; y < meta.height; y += STEP) {
  const height = Math.min(H, meta.height - y);
  await img.clone().extract({ left: 0, top: y, width: Math.min(W, meta.width), height }).png().toFile(`${outPrefix}-${String(i).padStart(2,'0')}.png`);
  i++;
}
console.log(`${i} crops from ${meta.width}x${meta.height}`);
