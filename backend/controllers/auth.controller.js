const { validationResult } = require('express-validator');

const { getSessionCookieName } = require('../config/session');
const authService = require('../services/auth.service');

const REGISTER_SUCCESS_MESSAGE =
  'Đăng ký thành công. Bạn có thể đăng nhập ngay bây giờ.';
const LOGOUT_SUCCESS_MESSAGE = 'Bạn đã đăng xuất thành công.';

const getOldInput = (body = {}) => ({
  name: typeof body.name === 'string' ? body.name : '',
  email: typeof body.email === 'string' ? body.email : '',
});

const getLoginOldInput = (body = {}) => ({
  email: typeof body.email === 'string' ? body.email : '',
});

const getFieldErrors = (req) => {
  const mappedErrors = validationResult(req).mapped();

  return Object.fromEntries(
    Object.entries(mappedErrors).map(([field, error]) => [field, error.msg]),
  );
};

const renderRegisterForm = (res, options = {}) =>
  res.status(options.statusCode || 200).render('auth/register', {
    pageTitle: 'Đăng ký tài khoản',
    errors: options.errors || {},
    oldInput: options.oldInput || {},
    successMessage: options.successMessage || '',
  });

const renderLoginForm = (res, options = {}) =>
  res.status(options.statusCode || 200).render('auth/login', {
    title: 'Đăng nhập',
    pageTitle: 'Đăng nhập',
    errors: options.errors || {},
    oldInput: options.oldInput || {},
    successMessage: options.successMessage || '',
    infoMessage: options.infoMessage || '',
  });

const showRegisterForm = (req, res) => renderRegisterForm(res);

const showLoginForm = (req, res) =>
  renderLoginForm(res, {
    successMessage:
      req.query.registered === '1' ? REGISTER_SUCCESS_MESSAGE : '',
    infoMessage:
      req.query.loggedOut === '1' ? LOGOUT_SUCCESS_MESSAGE : '',
  });

const register = async (req, res, next) => {
  const errors = getFieldErrors(req);
  const oldInput = getOldInput(req.body);

  if (Object.keys(errors).length > 0) {
    return renderRegisterForm(res, {
      statusCode: 422,
      errors,
      oldInput,
    });
  }

  try {
    await authService.registerUser({
      name: req.body.name,
      email: req.body.email,
      password: req.body.password,
    });

    return res.redirect(303, '/login?registered=1');
  } catch (error) {
    if (error.code === authService.EMAIL_ALREADY_EXISTS) {
      return renderRegisterForm(res, {
        statusCode: 409,
        errors: { email: authService.EMAIL_ALREADY_EXISTS_MESSAGE },
        oldInput,
      });
    }

    return next(error);
  }
};

const regenerateSession = (req) =>
  new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const saveSession = (req) =>
  new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const destroySession = (req) =>
  new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const login = async (req, res, next) => {
  const errors = getFieldErrors(req);
  const oldInput = getLoginOldInput(req.body);

  if (Object.keys(errors).length > 0) {
    return renderLoginForm(res, {
      statusCode: 422,
      errors,
      oldInput,
    });
  }

  try {
    const user = await authService.authenticateUser({
      email: req.body.email,
      password: req.body.password,
    });

    await regenerateSession(req);
    req.session.userId = user._id.toString();
    await saveSession(req);

    return res.redirect(303, '/');
  } catch (error) {
    const expectedErrors = {
      [authService.INVALID_CREDENTIALS]: {
        statusCode: 401,
        message: authService.INVALID_CREDENTIALS_MESSAGE,
      },
      [authService.ACCOUNT_BLOCKED]: {
        statusCode: 403,
        message: authService.ACCOUNT_BLOCKED_MESSAGE,
      },
      [authService.ACCOUNT_PENDING]: {
        statusCode: 403,
        message: authService.ACCOUNT_PENDING_MESSAGE,
      },
    };
    const expectedError = expectedErrors[error.code];

    if (expectedError) {
      return renderLoginForm(res, {
        statusCode: expectedError.statusCode,
        errors: { general: expectedError.message },
        oldInput,
      });
    }

    return next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    await destroySession(req);
    res.clearCookie(getSessionCookieName(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });

    return res.redirect(303, '/login?loggedOut=1');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  login,
  logout,
  register,
  showLoginForm,
  showRegisterForm,
};
