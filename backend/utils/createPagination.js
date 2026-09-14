const buildListingQuery = require('./buildListingQuery');
const {
  buildAdminListingsUrl,
  buildAdminUsersUrl,
} = require('./buildAdminQuery');

const PAGE_WINDOW_SIZE = 5;

const buildListingUrl = (filters, page) => {
  const query = buildListingQuery(filters, page);
  return query ? `/listings?${query}` : '/listings';
};

const buildFavoritesUrl = (page) =>
  Number.isSafeInteger(page) && page > 1
    ? `/favorites?page=${page}`
    : '/favorites';

const buildMessagesUrl = (page) =>
  Number.isSafeInteger(page) && page > 1
    ? `/messages?page=${page}`
    : '/messages';

const buildConversationMessagesUrl = (conversationId, page) => {
  const baseUrl = `/messages/${encodeURIComponent(String(conversationId))}`;

  return Number.isSafeInteger(page) && page > 1
    ? `${baseUrl}?page=${page}`
    : baseUrl;
};

const createPaginationLinks = (pagination, buildUrl) => {
  const { page, totalPages, hasPrev, hasNext } = pagination;
  const halfWindow = Math.floor(PAGE_WINDOW_SIZE / 2);
  let startPage = Math.max(1, page - halfWindow);
  let endPage = Math.min(totalPages, startPage + PAGE_WINDOW_SIZE - 1);

  startPage = Math.max(1, endPage - PAGE_WINDOW_SIZE + 1);

  const pages = [];

  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
    pages.push({
      number: pageNumber,
      isCurrent: pageNumber === page,
      url: buildUrl(pageNumber),
    });
  }

  return {
    ...pagination,
    pages,
    firstUrl: page > 1 ? buildUrl(1) : null,
    previousUrl: hasPrev ? buildUrl(page - 1) : null,
    nextUrl: hasNext ? buildUrl(page + 1) : null,
    lastUrl: page < totalPages ? buildUrl(totalPages) : null,
  };
};

const createPagination = (pagination, filters) =>
  createPaginationLinks(pagination, (page) => buildListingUrl(filters, page));

const createFavoritesPagination = (pagination) =>
  createPaginationLinks(pagination, buildFavoritesUrl);

const createMessagesPagination = (pagination) =>
  createPaginationLinks(pagination, buildMessagesUrl);

const createConversationMessagesPagination = (
  pagination,
  conversationId,
) =>
  createPaginationLinks(pagination, (page) =>
    buildConversationMessagesUrl(conversationId, page),
  );

const createAdminUsersPagination = (pagination, filters) =>
  createPaginationLinks(pagination, (page) =>
    buildAdminUsersUrl(filters, page),
  );

const createAdminListingsPagination = (pagination, filters) =>
  createPaginationLinks(pagination, (page) =>
    buildAdminListingsUrl(filters, page),
  );

module.exports = {
  buildAdminListingsUrl,
  buildAdminUsersUrl,
  buildConversationMessagesUrl,
  buildFavoritesUrl,
  buildListingUrl,
  buildMessagesUrl,
  createConversationMessagesPagination,
  createAdminListingsPagination,
  createAdminUsersPagination,
  createFavoritesPagination,
  createMessagesPagination,
  createPagination,
};
