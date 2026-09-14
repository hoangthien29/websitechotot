const { validationResult } = require('express-validator');

const adminListingService = require('../services/adminListing.service');
const categoryService = require('../services/category.service');
const {
  buildAdminListingsUrl,
  createAdminListingsPagination,
} = require('../utils/createPagination');
const normalizeAdminListingQuery = require('../utils/normalizeAdminListingQuery');
const presentAdminListing = require('../utils/presentAdminListing');

const SUCCESS_MESSAGES = {
  hidden: 'Bài đăng đã được ẩn bởi quản trị viên.',
  restored: 'Bài đăng đã được khôi phục.',
};

const renderNotFound = (req, res) =>
  res.status(404).render('errors/404', {
    pageTitle: 'Không tìm thấy trang',
    requestedUrl: req.originalUrl,
  });

const getErrors = (req) => {
  const errors = validationResult(req).array({ onlyFirstError: true });
  const result = {};

  for (const error of errors) {
    const key =
      error.type === 'unknown_fields' ? 'general' : error.path || 'general';
    if (!result[key]) {
      result[key] = error.msg;
    }
  }

  return result;
};

const getSuccessMessage = (query = {}) => {
  const key = Object.keys(SUCCESS_MESSAGES).find(
    (name) => query[name] === '1',
  );
  return key ? SUCCESS_MESSAGES[key] : '';
};

const renderListingDetail = async (req, res, options = {}) => {
  const detail = await adminListingService.getListingAdminDetail(
    req.params.id,
  );

  if (!detail) {
    return renderNotFound(req, res);
  }

  return res
    .status(options.statusCode || 200)
    .render('admin/listings/show', {
      pageTitle: `Kiểm duyệt ${detail.listing.title}`,
      listing: presentAdminListing(detail.listing),
      stats: detail.stats,
      errors: options.errors || {},
      oldInput: options.oldInput || { reason: '' },
      successMessage:
        options.successMessage || getSuccessMessage(req.query),
      pageStyles: ['/css/admin.css'],
    });
};

const listListings = async (req, res, next) => {
  try {
    const filters = normalizeAdminListingQuery(req.query);
    const categories = await categoryService.getAllCategoriesForAdmin();
    const errors = getErrors(req);

    if (Object.keys(errors).length > 0) {
      return res.status(422).render('admin/listings/index', {
        pageTitle: 'Kiểm duyệt bài đăng',
        listings: [],
        categories,
        filters,
        pagination: createAdminListingsPagination(
          {
            page: 1,
            limit: adminListingService.ADMIN_LISTINGS_PER_PAGE,
            totalItems: 0,
            totalPages: 1,
            hasPrev: false,
            hasNext: false,
          },
          filters,
        ),
        totalItems: 0,
        errors,
        pageStyles: ['/css/admin.css'],
      });
    }

    const result = await adminListingService.getListingsPage(filters);

    if (
      result.pagination.totalItems > 0 &&
      filters.page > result.pagination.totalPages
    ) {
      return res.redirect(
        302,
        buildAdminListingsUrl(filters, result.pagination.totalPages),
      );
    }

    return res.render('admin/listings/index', {
      pageTitle: 'Kiểm duyệt bài đăng',
      listings: result.items.map(presentAdminListing),
      categories,
      filters,
      pagination: createAdminListingsPagination(
        result.pagination,
        filters,
      ),
      totalItems: result.pagination.totalItems,
      errors: {},
      pageStyles: ['/css/admin.css'],
    });
  } catch (error) {
    return next(error);
  }
};

const showListing = async (req, res, next) => {
  try {
    const errors = getErrors(req);
    if (errors.id) {
      return renderNotFound(req, res);
    }

    return await renderListingDetail(req, res);
  } catch (error) {
    return next(error);
  }
};

const handleActionError = async (req, res, next, error) => {
  if (error.code === adminListingService.ADMIN_LISTING_NOT_FOUND) {
    return renderNotFound(req, res);
  }

  if (
    error.code === adminListingService.ADMIN_LISTING_STATE_INVALID ||
    error.code === adminListingService.ADMIN_LISTING_REASON_INVALID
  ) {
    try {
      return await renderListingDetail(req, res, {
        statusCode: 422,
        errors: { general: error.message },
        oldInput: {
          reason:
            typeof req.body.reason === 'string' ? req.body.reason : '',
        },
      });
    } catch (renderError) {
      return next(renderError);
    }
  }

  return next(error);
};

const hideListing = async (req, res, next) => {
  const errors = getErrors(req);

  if (errors.id) {
    return renderNotFound(req, res);
  }

  if (Object.keys(errors).length > 0) {
    try {
      return await renderListingDetail(req, res, {
        statusCode: 422,
        errors,
        oldInput: {
          reason:
            typeof req.body.reason === 'string' ? req.body.reason : '',
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  try {
    await adminListingService.hideListingByAdmin(
      req.params.id,
      req.user._id,
      req.body.reason,
    );
    return res.redirect(
      303,
      `/admin/listings/${req.params.id}?hidden=1`,
    );
  } catch (error) {
    return handleActionError(req, res, next, error);
  }
};

const restoreListing = async (req, res, next) => {
  const errors = getErrors(req);

  if (errors.id) {
    return renderNotFound(req, res);
  }

  if (Object.keys(errors).length > 0) {
    try {
      return await renderListingDetail(req, res, {
        statusCode: 422,
        errors,
      });
    } catch (error) {
      return next(error);
    }
  }

  try {
    await adminListingService.restoreListingByAdmin(req.params.id);
    return res.redirect(
      303,
      `/admin/listings/${req.params.id}?restored=1`,
    );
  } catch (error) {
    return handleActionError(req, res, next, error);
  }
};

module.exports = {
  hideListing,
  listListings,
  restoreListing,
  showListing,
};
