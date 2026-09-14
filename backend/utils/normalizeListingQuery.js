const CONDITIONS = ['new', 'used'];
const STATUSES = ['all', 'active', 'sold'];
const SORT_OPTIONS = ['newest', 'oldest', 'price-asc', 'price-desc'];

const getString = (value) =>
  typeof value === 'string' ? value.trim() : '';

const getOptionalInteger = (value) => {
  if (value === '' || value === undefined || value === null) {
    return null;
  }

  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
};

const normalizeListingQuery = (query = {}) => {
  const condition = getString(query.condition);
  const status = getString(query.status);
  const sort = getString(query.sort);
  const page = getOptionalInteger(query.page);

  return {
    keyword: getString(query.keyword),
    category: getString(query.category).toLowerCase(),
    condition: CONDITIONS.includes(condition) ? condition : '',
    minPrice: getOptionalInteger(query.minPrice),
    maxPrice: getOptionalInteger(query.maxPrice),
    location: getString(query.location),
    status: STATUSES.includes(status) ? status : 'all',
    sort: SORT_OPTIONS.includes(sort) ? sort : 'newest',
    page: Number.isSafeInteger(page) && page >= 1 && page <= 10000 ? page : 1,
  };
};

module.exports = normalizeListingQuery;
