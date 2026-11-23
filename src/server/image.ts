// Проверка загруженного изображения (ТЗ, раздел 10): JPEG, PNG, WebP, с проверкой содержимого.
// Тип определяется по сигнатуре файла, а не по тому, что заявил браузер; размеры читаются
// из заголовка. Браузер уменьшает картинку до 1568 px по длинной стороне и пересжимает её
// (заодно пропадают метаданные — координаты съёмки и т. п.), так что сюда приходит немного.

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';
export const IMAGE_TYPES: ImageType[] = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // что принимает страница до уменьшения
export const MAX_API_BYTES = 5 * 1024 * 1024; // что можно передать ИИ одним изображением
export const MAX_SIDE = 8000;
export const MIN_SIDE = 64;

export interface ImageCheck {
  ok: boolean;
  error?: string;
  type?: ImageType;
  width?: number;
  height?: number;
  bytes?: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** Тип и размеры по заголовку файла. null — не JPEG, не PNG и не WebP или заголовок испорчен. */
export function sniffImage(b: Uint8Array): { type: ImageType; width: number; height: number } | null {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR')
    return { type: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    // Ищем маркер начала кадра SOF0…SOF15 (кроме DHT C4, JPG C8, DAC CC).
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = u16be(b, i + 2);
      if (len < 2) return null;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { type: 'image/jpeg', height: u16be(b, i + 5), width: u16be(b, i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)
      return { type: 'image/webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { type: 'image/webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    return null;
  }
  return null;
}

export function checkImage(b: Uint8Array, declared?: string, maxBytes = MAX_API_BYTES): ImageCheck {
  if (!b.length) return { ok: false, error: 'пустой файл' };
  if (b.length > maxBytes) return { ok: false, error: `изображение больше ${Math.round(maxBytes / 1024 / 1024)} МБ` };
  const s = sniffImage(b);
  if (!s) return { ok: false, error: 'это не JPEG, PNG или WebP (или файл повреждён)' };
  if (declared && declared !== s.type) return { ok: false, error: `заявлен ${declared}, а по содержимому это ${s.type}` };
  if (s.width < MIN_SIDE || s.height < MIN_SIDE) return { ok: false, error: `слишком маленькое изображение: ${s.width}×${s.height}, нужно от ${MIN_SIDE} px` };
  if (s.width > MAX_SIDE || s.height > MAX_SIDE) return { ok: false, error: `слишком большое изображение: ${s.width}×${s.height}, не больше ${MAX_SIDE} px` };
  return { ok: true, type: s.type, width: s.width, height: s.height, bytes: b.length };
}
