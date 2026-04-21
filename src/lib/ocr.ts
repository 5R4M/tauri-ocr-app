import { createWorker, PSM } from 'tesseract.js';

export interface OcrWord {
  text: string;
  confidence: number;
  x0: number; y0: number; x1: number; y1: number;
}

function prepareImage(dataUrl: string, maxDim = 1800): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const W = Math.round(img.width * scale);
      const H = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, W, H);
      const { data: px } = ctx.getImageData(0, 0, W, H);
      const N = W * H;

      // 1. Escala de grises con pesos perceptuales enteros (sin float)
      const g = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        g[i] = (77 * px[i * 4] + 150 * px[i * 4 + 1] + 29 * px[i * 4 + 2]) >> 8;
      }

      // 2. Sharpening Laplaciano 5-tap para afilar bordes de letras
      const s = new Uint8Array(N);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          const v = 5 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
          s[i] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
      for (let x = 0; x < W; x++) { s[x] = g[x]; s[(H - 1) * W + x] = g[(H - 1) * W + x]; }
      for (let y = 0; y < H; y++) { s[y * W] = g[y * W]; s[y * W + W - 1] = g[y * W + W - 1]; }

      // 3. Imagen integral para media local (O(1) por pixel)
      //    Radio adaptativo: cubre ~1/20 del ancho, entre 15 y 60 px
      const r = Math.max(15, Math.min(60, (W / 20) | 0));
      const II = new Uint32Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const ii = (y + 1) * (W + 1) + (x + 1);
          II[ii] = s[y * W + x] + II[y * (W + 1) + (x + 1)] + II[(y + 1) * (W + 1) + x] - II[y * (W + 1) + x];
        }
      }

      // 4. Umbral adaptativo local: pixel < (media_local - bias) → negro
      //    Maneja iluminación desigual, sombras y gradientes de luz
      const BIAS = 8;
      const bin = new Uint8Array(N);
      let darkPx = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const x0 = x - r < 0 ? 0 : x - r;
          const y0 = y - r < 0 ? 0 : y - r;
          const x1 = x + r >= W ? W - 1 : x + r;
          const y1 = y + r >= H ? H - 1 : y + r;
          const area = (x1 - x0 + 1) * (y1 - y0 + 1);
          const sum = II[(y1 + 1) * (W + 1) + (x1 + 1)]
                    - II[y0 * (W + 1) + (x1 + 1)]
                    - II[(y1 + 1) * (W + 1) + x0]
                    + II[y0 * (W + 1) + x0];
          const localMean = sum / area;
          const i = y * W + x;
          const v = s[i] < localMean - BIAS ? 0 : 255;
          bin[i] = v;
          if (v === 0) darkPx++;
        }
      }

      // 5. Auto-inversión: si >55% pixels son oscuros, el texto es claro sobre fondo oscuro
      const invert = darkPx > N * 0.55;

      const out = ctx.createImageData(W, H);
      const od = out.data;
      for (let i = 0; i < N; i++) {
        const v = invert ? 255 - bin[i] : bin[i];
        od[i * 4] = od[i * 4 + 1] = od[i * 4 + 2] = v;
        od[i * 4 + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = dataUrl;
  });
}

function cleanText(raw: string): string {
  return raw
    .replace(/\f/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function processImageOCR(
  imageSource: string,
  onProgress: (progress: number, status: string) => void
): Promise<{ text: string; words: OcrWord[] }> {
  try {
    onProgress(0, 'Preparando imagen...');
    const prepared = await prepareImage(imageSource);

    const worker = await createWorker(['spa', 'eng'], 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          onProgress(m.progress * 100, 'Extrayendo texto...');
        } else if (m.status === 'loading tesseract core') {
          onProgress(m.progress * 10, 'Cargando motor OCR...');
        } else if (m.status === 'initializing tesseract') {
          onProgress(10 + m.progress * 10, 'Inicializando...');
        } else if (m.status === 'loading language traineddata') {
          onProgress(20 + m.progress * 60, 'Cargando modelos de idioma...');
        } else if (m.status === 'initializing api') {
          onProgress(80 + m.progress * 10, 'Preparando análisis...');
        }
      }
    });

    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });

    onProgress(90, 'Reconociendo texto...');
    const { data } = await worker.recognize(prepared);
    await worker.terminate();

    const words: OcrWord[] = (data.words ?? []).map(w => ({
      text: w.text,
      confidence: w.confidence,
      x0: w.bbox.x0, y0: w.bbox.y0,
      x1: w.bbox.x1, y1: w.bbox.y1,
    }));

    return { text: cleanText(data.text), words };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('load')) {
      throw new Error('Sin conexión: se necesita internet la primera vez para descargar los modelos OCR (~30MB).');
    }
    throw new Error('No se pudo extraer el texto. Intenta con una imagen más nítida y con buena luz.');
  }
}
