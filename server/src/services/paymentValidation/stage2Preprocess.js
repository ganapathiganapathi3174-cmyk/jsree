import sharp from 'sharp';
import { preprocessImage } from '../ocrService.js';

/**
 * Stage 2: Image Preprocessing
 */
export async function preprocessForOCR(buffer) {
  try {
    // Use existing optimized preprocessing
    const processed = await preprocessImage(buffer);
    return { success: true, buffer: processed };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
