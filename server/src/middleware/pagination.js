export const paginate = (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  req.pagination = { page, limit, offset };
  next();
};

export const paginatedResponse = (data, count, page, limit) => ({
  data,
  pagination: {
    page,
    limit,
    total: count,
    totalPages: Math.ceil(count / limit),
    hasNext: page * limit < count,
    hasPrev: page > 1
  }
});
