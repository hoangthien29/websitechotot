const { validationResult } = require('express-validator');

const adminUserService = require('../services/adminUser.service');
const {
  buildAdminUsersUrl,
  createAdminUsersPagination,
} = require('../utils/createPagination');
const normalizeAdminUserQuery = require('../utils/normalizeAdminUserQuery');
const presentAdminUser = require('../utils/presentAdminUser');
const presentAdminListing = require('../utils/presentAdminListing');

const SUCCESS_MESSAGES = {
  approved: 'Tài khoản đã được duyệt.',
  blocked: 'Tài khoản đã được khóa.',
  unblocked: 'Tài khoản đã được mở khóa.',
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

const renderUserDetail = async (req, res, options = {}) => {
  const detail = await adminUserService.getUserAdminDetail(req.params.id);

  if (!detail) {
    return renderNotFound(req, res);
  }

  return res.status(options.statusCode || 200).render('admin/users/show', {
    pageTitle: `Quản lý ${detail.user.name}`,
    adminUser: presentAdminUser(detail.user),
    stats: detail.stats,
    recentListings: detail.recentListings.map(presentAdminListing),
    errors: options.errors || {},
    oldInput: options.oldInput || { reason: '' },
    successMessage:
      options.successMessage || getSuccessMessage(req.query),
    currentAdminId: req.user._id.toString(),
    pageStyles: ['/css/admin.css'],
  });
};

const listUsers = async (req, res, next) => {
  try {
    const filters = normalizeAdminUserQuery(req.query);
    const errors = getErrors(req);

    if (Object.keys(errors).length > 0) {
      return res.status(422).render('admin/users/index', {
        pageTitle: 'Quản lý người dùng',
        users: [],
        filters,
        pagination: createAdminUsersPagination(
          {
            page: 1,
            limit: adminUserService.ADMIN_USERS_PER_PAGE,
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

    const result = await adminUserService.getUsersPage(filters);

    if (
      result.pagination.totalItems > 0 &&
      filters.page > result.pagination.totalPages
    ) {
      return res.redirect(
        302,
        buildAdminUsersUrl(filters, result.pagination.totalPages),
      );
    }

    return res.render('admin/users/index', {
      pageTitle: 'Quản lý người dùng',
      users: result.items.map(presentAdminUser),
      filters,
      pagination: createAdminUsersPagination(
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

const showUser = async (req, res, next) => {
  try {
    const errors = getErrors(req);
    if (errors.id) {
      return renderNotFound(req, res);
    }

    return await renderUserDetail(req, res);
  } catch (error) {
    return next(error);
  }
};

const handleActionError = async (req, res, next, error) => {
  if (error.code === adminUserService.ADMIN_USER_NOT_FOUND) {
    return renderNotFound(req, res);
  }

  if (error.code === adminUserService.ADMIN_USER_PROTECTED) {
    return res.status(403).render('errors/403', {
      pageTitle: 'Không thể thay đổi tài khoản quản trị',
    });
  }

  if (
    error.code === adminUserService.ADMIN_USER_TRANSITION_INVALID ||
    error.code === adminUserService.ADMIN_BLOCK_REASON_INVALID
  ) {
    try {
      return await renderUserDetail(req, res, {
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

const approveUser = async (req, res, next) => {
  const errors = getErrors(req);

  if (errors.id) {
    return renderNotFound(req, res);
  }

  if (Object.keys(errors).length > 0) {
    try {
      return await renderUserDetail(req, res, {
        statusCode: 422,
        errors,
      });
    } catch (error) {
      return next(error);
    }
  }

  try {
    await adminUserService.approveUser(req.params.id, req.user._id);
    return res.redirect(303, `/admin/users/${req.params.id}?approved=1`);
  } catch (error) {
    return handleActionError(req, res, next, error);
  }
};

const blockUser = async (req, res, next) => {
  const errors = getErrors(req);

  if (errors.id) {
    return renderNotFound(req, res);
  }

  if (Object.keys(errors).length > 0) {
    try {
      return await renderUserDetail(req, res, {
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
    await adminUserService.blockUser(
      req.params.id,
      req.user._id,
      req.body.reason,
    );
    return res.redirect(303, `/admin/users/${req.params.id}?blocked=1`);
  } catch (error) {
    return handleActionError(req, res, next, error);
  }
};

const unblockUser = async (req, res, next) => {
  const errors = getErrors(req);

  if (errors.id) {
    return renderNotFound(req, res);
  }

  if (Object.keys(errors).length > 0) {
    try {
      return await renderUserDetail(req, res, {
        statusCode: 422,
        errors,
      });
    } catch (error) {
      return next(error);
    }
  }

  try {
    await adminUserService.unblockUser(req.params.id, req.user._id);
    return res.redirect(303, `/admin/users/${req.params.id}?unblocked=1`);
  } catch (error) {
    return handleActionError(req, res, next, error);
  }
};

module.exports = {
  approveUser,
  blockUser,
  listUsers,
  showUser,
  unblockUser,
};
