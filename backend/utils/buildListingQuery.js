const buildListingQuery = (filters = {}, page = filters.page) => {
  const params = new URLSearchParams();

  if (filters.keyword) {
    params.set('keyword', filters.keyword);
  }

  if (filters.category) {
    params.set('category', filters.category);
  }

  if (filters.condition) {
    params.set('condition', filters.condition);
  }

  if (filters.minPrice !== null && filters.minPrice !== undefined) {
    params.set('minPrice', String(filters.minPrice));
  }

  if (filters.maxPrice !== null && filters.maxPrice !== undefined) {
    params.set('maxPrice', String(filters.maxPrice));
  }

  if (filters.location) {
    params.set('location', filters.location);
  }

  if (filters.status && filters.status !== 'all') {
    params.set('status', filters.status);
  }

  if (filters.sort && filters.sort !== 'newest') {
    params.set('sort', filters.sort);
  }

  if (Number.isSafeInteger(page) && page > 1) {
    params.set('page', String(page));
  }

  return params.toString();
};

module.exports = buildListingQuery;
