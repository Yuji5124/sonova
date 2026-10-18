export * from './image.ts';
export { fft, powerSpectrum2D } from './fft.ts';

export const ANALYZER_VERSION = 'sonova-analyzer/1.0.0';

/** Source kinds SONOVA is designed for. Only `image` is implemented in Phase 1–3. */
export type SourceType = 'image' | 'model3d' | 'text' | 'code';

export const SOURCE_TYPE_STATUS: Record<SourceType, { label: string; implemented: boolean; formats: string[] }> = {
  image: { label: 'PHOTO INSTRUMENT', implemented: true, formats: ['png', 'jpg', 'jpeg'] },
  model3d: { label: '3D INSTRUMENT', implemented: false, formats: ['glb', 'gltf'] },
  text: { label: 'TEXT INSTRUMENT', implemented: false, formats: ['txt', 'md'] },
  code: { label: 'CODE INSTRUMENT', implemented: false, formats: ['py', 'js', 'ts'] },
};

/** SHA-256 of the raw source bytes (WebCrypto exists in browsers and Node 20+). */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', view as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
