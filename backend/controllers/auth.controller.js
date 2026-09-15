const { validationResult } = require('express-validator');

const { getSessionCookieName } = require('../config/session');
const authService = require('../services/auth.service');

const REGISTER_SUCCESS_MESSAGE =
  'Đăng ký thành công. Bạn có thể đăng nhập ngay bây giờ.';
const LOGOUT_SUCCESS_MESSAGE = 'Bạn đã đăng xuất thành công.';
const GOOGLE_AUTH_FAILED_MESSAGE = 'Đăng nhập Google thất bại. Vui lòng thử lại.';

const getGoogleRedirectUri = () =>
  process.env.GOOGLE_REDIRECT_URI ||
  `${process.env.APP_BASE_URL || 'http://localhost:3000'}/auth/google/callback`;

const getGoogleAuthUrl = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return null;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGoogleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

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

const googleLogin = (req, res) => {
  const googleAuthUrl = getGoogleAuthUrl();

  if (!googleAuthUrl) {
    return res.redirect(303, '/login?googleAuthDisabled=1');
  }

  return res.redirect(303, googleAuthUrl);
};

const googleCallback = async (req, res, next) => {
  const { code } = req.query;

  if (!code || typeof code !== 'string') {
    return res.redirect(303, '/login?googleAuthError=1');
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: getGoogleRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      throw authService.createGoogleAuthError?.(GOOGLE_AUTH_FAILED_MESSAGE) ||
        new Error(GOOGLE_AUTH_FAILED_MESSAGE);
    }

    const tokenData = await tokenResponse.json();
    const userInfoResponse = await fetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      },
    );

    if (!userInfoResponse.ok) {
      throw authService.createGoogleAuthError?.(GOOGLE_AUTH_FAILED_MESSAGE) ||
        new Error(GOOGLE_AUTH_FAILED_MESSAGE);
    }

    const profile = await userInfoResponse.json();
    const { user } = await authService.findOrCreateGoogleUser(profile);

    await regenerateSession(req);
    req.session.userId = user._id.toString();
    await saveSession(req);

    return res.redirect(303, '/');
  } catch (error) {
    if (error.code === authService.ACCOUNT_BLOCKED) {
      return renderLoginForm(res, {
        statusCode: 403,
        errors: { general: authService.ACCOUNT_BLOCKED_MESSAGE },
      });
    }

    if (error.code === authService.ACCOUNT_PENDING) {
      return renderLoginForm(res, {
        statusCode: 403,
        errors: { general: authService.ACCOUNT_PENDING_MESSAGE },
      });
    }

    if (error.code === authService.GOOGLE_AUTH_ERROR) {
      return renderLoginForm(res, {
        statusCode: 401,
        errors: { general: error.message },
      });
    }

    return next(error);
  }
};

module.exports = {
  googleCallback,
  googleLogin,
  login,
  logout,
  register,
  showLoginForm,
  showRegisterForm,
};
