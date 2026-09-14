const { validationResult } = require('express-validator');

const favoriteService = require('../services/favorite.service');
const {
  createFavoritesPagination,
} = require('../utils/createPagination');
const presentListing = require('../utils/presentListing');
const { safeReturnTo } = require('../utils/safeReturnTo');

const getFieldErrors = (req) => {
  const mappedErrors = validationResult(req).mapped();

  return Object.fromEntries(
    Object.entries(mappedErrors).map(([field, error]) => [field, error.msg]),
  );
};

const renderNotFound = (req, res) =>
  res.status(404).render('errors/404', {
    pageTitle: 'Không tìm thấy trang',
    requestedUrl: req.originalUrl,
  });

const renderForbidden = (res) =>
  res.status(403).render('errors/403', {
    pageTitle: 'Không có quyền thực hiện',
  });

const getEmptyPagination = () =>
  createFavoritesPagination({
    page: 1,
    limit: favoriteService.FAVORITES_PER_PAGE,
    totalItems: 0,
    totalPages: 1,
    hasPrev: false,
    hasNext: false,
    previousPage: null,
    nextPage: null,
  });

const listFavorites = async (req, res, next) => {
  const errors = getFieldErrors(req);

  if (Object.keys(errors).length > 0) {
    return res.status(422).render('favorites/index', {
      pageTitle: 'Tin đã lưu',
      listings: [],
      pagination: getEmptyPagination(),
      totalItems: 0,
      currentPage: 1,
      currentUrl: '/favorites',
      errors,
    });
  }

  try {
    const page = Number(req.query.page || 1);
    const result = await favoriteService.getUserFavoritesPage(
      req.user._id,
      page,
      favoriteService.FAVORITES_PER_PAGE,
    );

    if (
      result.pagination.totalItems > 0 &&
      page > result.pagination.totalPages
    ) {
      const lastPageUrl =
        result.pagination.totalPages > 1
          ? `/favorites?page=${result.pagination.totalPages}`
          : '/favorites';
      return res.redirect(302, lastPageUrl);
    }

    const pagination = createFavoritesPagination(result.pagination);

    return res.render('favorites/index', {
      pageTitle: 'Tin đã lưu',
      listings: result.items.map((listing) =>
        presentListing(listing, { isFavorited: true }),
      ),
      pagination,
      totalItems: pagination.totalItems,
      currentPage: pagination.page,
      currentUrl: req.originalUrl,
      errors: {},
    });
  } catch (error) {
    return next(error);
  }
};

const addFavorite = async (req, res, next) => {
  if (Object.keys(getFieldErrors(req)).length > 0) {
    return renderNotFound(req, res);
  }

  try {
    await favoriteService.addFavorite(req.user._id, req.params.id);
    const fallback = `/listings/${req.params.id}`;
    return res.redirect(303, safeReturnTo(req.body?.returnTo, fallback));
  } catch (error) {
    if (error.code === favoriteService.FAVORITE_LISTING_NOT_FOUND) {
      return renderNotFound(req, res);
    }

    if (error.code === favoriteService.FAVORITE_OWN_LISTING) {
      return renderForbidden(res);
    }

    return next(error);
  }
};

const removeFavorite = async (req, res, next) => {
  if (Object.keys(getFieldErrors(req)).length > 0) {
    return renderNotFound(req, res);
  }

  try {
    await favoriteService.removeFavorite(req.user._id, req.params.id);
    return res.redirect(303, safeReturnTo(req.body?.returnTo, '/favorites'));
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  addFavorite,
  listFavorites,
  removeFavorite,
};
