// Request timeout middleware — fails fast if a request exceeds the configured
// duration. This prevents hung requests from consuming resources indefinitely
// (especially important for OCR verification endpoints that can take 50-100s+).
// The timeout is set slightly below the frontend timeout (240s) so the backend
// responds with a structured error before the client aborts.

export const REQUEST_TIMEOUT_MS = 180000; // 3 minutes

export function requestTimeout() {
  return (req, res, next) => {
    // Skip timeout for health checks
    if (req.path === '/health') return next();

    const timeoutId = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          message: 'Request timed out. The server took too long to process the request (likely OCR verification or cold start). Please try again.',
          code: 'REQUEST_TIMEOUT'
        });
      }
      // Force-close the connection AFTER the response is fully sent to free resources
      // Use res.on('finish') to ensure the response body is flushed to the client
      if (!res.writableEnded) {
        res.on('finish', () => {
          if (typeof req.destroy === 'function') req.destroy();
        });
      } else {
        if (typeof req.destroy === 'function') req.destroy();
      }
    }, REQUEST_TIMEOUT_MS);

    // Clear timeout when response finishes normally
    res.on('finish', () => clearTimeout(timeoutId));
    res.on('close', () => clearTimeout(timeoutId));
    req.on('close', () => clearTimeout(timeoutId));

    next();
  };
}

export default requestTimeout;