const { csrfSync } = require('csrf-sync');

const CSRF_FIELD_NAME = '_csrf';
const CSRF_ERROR_CODE = 'EBADCSRFTOKEN';

const getTokenFromRequest = (req) => {
  const bodyToken = req.body?.[CSRF_FIELD_NAME];

  if (typeof bodyToken === 'string') {
    return bodyToken;
  }

  const headerToken = req.get?.('x-csrf-token');
  return typeof headerToken === 'string' ? headerToken : undefined;
};

const options = {
  errorConfig: {
    statusCode: 403,
    message: 'Yêu cầu bảo mật không hợp lệ hoặc đã hết hạn.',
    code: CSRF_ERROR_CODE,
  },
  getTokenFromRequest,
};

const isManagedMultipartMutation = (req) => {
  if (!req.is('multipart/form-data')) {
    return false;
  }

  const pathname = req.path;
  const method = req.method;

  return (
    (method === 'PUT' && pathname === '/profile') ||
    (method === 'POST' && pathname === '/listings') ||
    (method === 'PUT' && /^\/listings\/[0-9a-f]{24}$/i.test(pathname)) ||
    (method === 'POST' && pathname === '/admin/categories') ||
    (method === 'PUT' && /^\/admin\/categories\/[0-9a-f]{24}$/i.test(pathname))
  );
};

const standardCsrf = csrfSync({
  ...options,
  skipCsrfProtection: isManagedMultipartMutation,
});
const multipartCsrf = csrfSync(options);

module.exports = {
  CSRF_ERROR_CODE,
  CSRF_FIELD_NAME,
  csrfProtection: standardCsrf.csrfSynchronisedProtection,
  generateCsrfToken: standardCsrf.generateToken,
  isManagedMultipartMutation,
  multipartCsrfProtection: multipartCsrf.csrfSynchronisedProtection,
};
