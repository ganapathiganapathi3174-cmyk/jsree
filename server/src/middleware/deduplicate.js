// Request deduplication middleware — prevents accidental duplicate submissions
// (e.g., user clicks "Verify" twice, or client retries on timeout).
// Uses a hash of (userId + endpoint + fileContentHash) as the deduplication key.
// Entries expire after 5 minutes to allow legitimate retries after failures.

import crypto from 'crypto';

const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const inFlight = new Map(); // key -> { promise, timestamp }

// Test-only helper to clear the in-flight map
export function __testClearInFlight() {
  inFlight.clear();
}

export function deduplicateProofUpload() {
  return (req, res, next) => {
    // Only apply to proof upload endpoints
    const isProofEndpoint = req.path?.includes('/proof') 
      || req.path?.includes('/direct') 
      || req.path?.includes('/screenshot');
    if (!isProofEndpoint) {
      return next();
    }

    const userId = req.user?.id;
    if (!userId) return next(); // auth middleware will handle unauthorized

    // Create a hash of the file content for deduplication
    const file = req.file;
    if (!file || !file.buffer) return next();

    const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex').slice(0, 16);
    const key = `${userId}:${req.path}:${fileHash}`;

    const existing = inFlight.get(key);
    const now = Date.now();

    // Clean up expired entries
    if (existing && now - existing.timestamp > DEDUP_TTL_MS) {
      inFlight.delete(key);
    }

    if (inFlight.has(key)) {
      // Duplicate request detected - return the existing promise's result
      // or a 409 if the previous request is still in flight
      const prev = inFlight.get(key);
      if (prev.promise) {
        return res.status(409).json({
          success: false,
          message: 'A verification for this screenshot is already in progress. Please wait for the result.',
          code: 'DUPLICATE_REQUEST'
        });
      }
    }

    // Mark this request as in-flight
    const promise = new Promise((resolve) => {
      // Store the resolve function to be called when the response finishes
      req._dedupResolve = resolve;
    });

    inFlight.set(key, { promise, timestamp: now });

    // Clean up when response finishes
    res.on('finish', () => {
      inFlight.delete(key);
    });
    res.on('close', () => {
      inFlight.delete(key);
    });

    next();
  };
}

export default deduplicateProofUpload;