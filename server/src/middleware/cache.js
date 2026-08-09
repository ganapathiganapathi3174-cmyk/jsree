const cache = new Map();
const DEFAULT_TTL = 60 * 1000;

export const cacheMiddleware = (ttl = DEFAULT_TTL) => (req, res, next) => {
  if (req.method !== 'GET') return next();
  const key = `${req.user?.id || 'anon'}:${req.originalUrl}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return res.json(cached.data);
  }
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    cache.set(key, { data, timestamp: Date.now() });
    return originalJson(data);
  };
  next();
};

export const clearCache = (pattern) => {
  if (!pattern) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key);
  }
};

export const cacheStats = () => ({
  size: cache.size,
  keys: [...cache.keys()]
});
