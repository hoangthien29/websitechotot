const addValue = (params, key, value, defaultValue = '') => {
  if (value && value !== defaultValue) {
    params.set(key, String(value));
  }
};

const addPage = (params, page) => {
  if (Number.isSafeInteger(page) && page > 1) {
    params.set('page', String(page));
  }
};

const buildUrl = (pathname, params) => {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};

const buildAdminUsersUrl = (filters = {}, page = filters.page) => {
  const params = new URLSearchParams();

  addValue(params, 'keyword', filters.keyword);
  addValue(params, 'status', filters.status, 'all');
  addValue(params, 'role', filters.role, 'all');
  addValue(params, 'sort', filters.sort, 'newest');
  addPage(params, page);

  return buildUrl('/admin/users', params);
};

const buildAdminListingsUrl = (filters = {}, page = filters.page) => {
  const params = new URLSearchParams();

  addValue(params, 'keyword', filters.keyword);
  addValue(params, 'category', filters.category);
  addValue(params, 'status', filters.status, 'all');
  addValue(params, 'moderation', filters.moderation, 'all');
  addValue(params, 'seller', filters.seller);
  addValue(params, 'sort', filters.sort, 'newest');
  addPage(params, page);

  return buildUrl('/admin/listings', params);
};

module.exports = {
  buildAdminListingsUrl,
  buildAdminUsersUrl,
};
