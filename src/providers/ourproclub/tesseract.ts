import { tmpdir } from 'node:os';
import type { Ocr } from './match-image.js';

/**
 * Lector de texto gratuito (Tesseract compilado a WebAssembly, sin servicios externos de pago).
 * El modelo de inglés se descarga una vez y queda en la carpeta temporal del servidor.
 * Se carga solo cuando hay una imagen que leer.
 */

const PSM = { line: '7', word: '8', raw: '13', block: '6' } as const;

export interface ClosableOcr extends Ocr {
  close(): Promise<void>;
}

export async function createTesseractOcr(): Promise<ClosableOcr> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, { cachePath: tmpdir() });
  let last = '';
  return {
    async read(png, { chars, mode }) {
      const key = `${PSM[mode]}|${chars ?? ''}`;
      if (key !== last) {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM[mode] as never,
          tessedit_char_whitelist: chars ?? '',
        });
        last = key;
      }
      const { data } = await worker.recognize(Buffer.from(png));
      return data.text;
    },
    async close() {
      await worker.terminate();
    },
  };
}
