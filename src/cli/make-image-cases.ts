// Нарисовать проверочный набор этапа 5: data/image-cases/*.png и разметку data/image-cases.json.
// Запуск: npm run make-image-cases
import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { drawSvg } from '../tools/draw.ts';
import { IMAGE_CASES } from '../tools/image-cases.ts';

mkdirSync('data/image-cases', { recursive: true });
const index = [];
for (const c of IMAGE_CASES) {
  const svg = drawSvg(c.draw, c.view, c.style, c.ref);
  const png = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Arial' } }).render().asPng();
  writeFileSync(`data/image-cases/${c.id}.png`, png);
  index.push({ id: c.id, file: `image-cases/${c.id}.png`, title: c.title, text: c.text ?? '', view: c.view, style: c.style, scale: c.ref, expect: c.expect });
  console.log(`${c.id}.png  ${(png.length / 1024).toFixed(0)} КБ  ${c.title}`);
}
writeFileSync('data/image-cases.json', JSON.stringify({ note: 'Нарисовано src/tools/draw.ts; разметка — из тех же размеров. Регенерация: npm run make-image-cases', cases: index }, null, 1));
