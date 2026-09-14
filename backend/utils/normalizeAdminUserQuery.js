const USER_STATUSES = ['all', 'active', 'pending', 'blocked'];
const USER_ROLES = ['all', 'user', 'admin'];
const USER_SORTS = ['newest', 'oldest', 'name-asc', 'name-desc'];

const getString = (value) =>
  typeof value === 'string' ? value.trim() : '';

const getPage = (value) => {
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= 10000
    ? page
    : 1;
};

const normalizeAdminUserQuery = (query = {}) => {
  const status = getString(query.status);
  const role = getString(query.role);
  const sort = getString(query.sort);

  return {
    keyword: getString(query.keyword),
    status: USER_STATUSES.includes(status) ? status : 'all',
    role: USER_ROLES.includes(role) ? role : 'all',
    sort: USER_SORTS.includes(sort) ? sort : 'newest',
    page: getPage(query.page),
  };
};

module.exports = normalizeAdminUserQuery;
