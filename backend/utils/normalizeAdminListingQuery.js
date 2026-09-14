const LISTING_STATUSES = ['all', 'active', 'sold', 'hidden'];
const MODERATION_FILTERS = [
  'all',
  'admin-hidden',
  'owner-hidden',
  'not-hidden',
];
const LISTING_SORTS = [
  'newest',
  'oldest',
  'price-asc',
  'price-desc',
  'title-asc',
];

const getString = (value) =>
  typeof value === 'string' ? value.trim() : '';

const getPage = (value) => {
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= 10000
    ? page
    : 1;
};

const normalizeAdminListingQuery = (query = {}) => {
  const status = getString(query.status);
  const moderation = getString(query.moderation);
  const sort = getString(query.sort);

  return {
    keyword: getString(query.keyword),
    category: getString(query.category).toLowerCase(),
    status: LISTING_STATUSES.includes(status) ? status : 'all',
    moderation: MODERATION_FILTERS.includes(moderation)
      ? moderation
      : 'all',
    seller: getString(query.seller),
    sort: LISTING_SORTS.includes(sort) ? sort : 'newest',
    page: getPage(query.page),
  };
};

module.exports = normalizeAdminListingQuery;
