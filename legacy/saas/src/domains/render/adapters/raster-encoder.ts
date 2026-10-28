import sharp from "sharp";
import type { RenderFormat } from "../types";

export interface EncodedImage {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/**
 * Encodes raw RGBA pixel bytes from the maplibre-native renderer into the
 * requested output format using sharp (libvips). Both PNG and WebP are
 * native libvips paths so no platform-specific code is needed.
 */
export async function encodeRgbaToImage(
  width: number,
  height: number,
  rgba: Uint8Array,
  format: RenderFormat,
): Promise<EncodedImage> {
  const expected = width * height * 4;
  if (rgba.byteLength !== expected) {
    throw new Error(`encodeRgbaToImage: expected ${expected} bytes, received ${rgba.byteLength}`);
  }
  const pipeline = sharp(Buffer.from(rgba), {
    raw: {
      width,
      height,
      channels: 4,
    },
  });
  if (format === "webp") {
    const bytes = await pipeline.webp({ quality: 85 }).toBuffer();
    return { bytes: new Uint8Array(bytes), contentType: "image/webp" };
  }
  const bytes = await pipeline.png({ compressionLevel: 6 }).toBuffer();
  return { bytes: new Uint8Array(bytes), contentType: "image/png" };
}
