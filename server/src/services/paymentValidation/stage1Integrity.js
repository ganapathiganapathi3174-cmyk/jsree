import crypto from 'crypto';
import sharp from 'sharp';

/**
 * Stage 1: Upload and Image Integrity Validation
 */
export async function validateImageIntegrity(buffer, file) {
  const errors = [];
  const warnings = [];

  if (!buffer || !Buffer.isBuffer(buffer)) {
    errors.push('Invalid image buffer');
    return { valid: false, errors, warnings };
  }

  if (buffer.length === 0) {
    errors.push('Empty image file');
    return { valid: false, errors, warnings };
  }

  // Check file size (max 5MB)
  const maxSize = 5 * 1024 * 1024;
  if (buffer.length > maxSize) {
    errors.push('Image exceeds maximum size of 5MB');
    return { valid: false, errors, warnings };
  }

  // Check file header for actual format.
  // JPEG SOI is ffd8ff followed by ANY marker byte (ffe0 JFIF, ffe1 Exif,
  // ffe2/ffdb/ffc0/ffc4/ffda ... are all legitimate JPEG variants) — match
  // the 3-byte SOI prefix instead of enumerating APP markers, otherwise a
  // valid screenshot written by an encoder we did not enumerate is rejected.
  const head = buffer.slice(0, 12);
  const signature = head.slice(0, 4).toString('hex');
  const isPNG = signature === '89504e47';
  const isJPEG = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWEBP = signature === '52494646' && head.slice(8, 12).toString('ascii') === 'WEBP';

  if (!isPNG && !isJPEG && !isWEBP) {
    errors.push('Unsupported or corrupted image format');
    return { valid: false, errors, warnings };
  }

  // Decode probe: magic bytes only prove the header, not the payload. A
  // truncated/corrupted file must fail HERE, not deep inside OCR where it is
  // indistinguishable from an infrastructure failure.
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) {
      errors.push('Image could not be decoded');
      return { valid: false, errors, warnings };
    }
  } catch (e) {
    errors.push('Image could not be decoded');
    return { valid: false, errors, warnings };
  }

  // Calculate hash for duplicate detection
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  return { valid: true, errors, warnings, hash, size: buffer.length };
}
