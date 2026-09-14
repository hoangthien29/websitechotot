const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const guestCookiesByBaseUrl = new Map();

const getCookiePair = (setCookie = '') => setCookie.split(';', 1)[0];

const extractCsrfToken = (html) => {
  const match = String(html).match(
    /<input\b[^>]*name=["']_csrf["'][^>]*value=["']([^"']+)["'][^>]*>/i,
  );

  return match?.[1] || '';
};

const prepareCsrfHeaders = async ({
  baseUrl,
  cookie = '',
  headers,
  method = 'GET',
  skipCsrf = false,
}) => {
  if (skipCsrf || !STATE_CHANGING_METHODS.has(String(method).toUpperCase())) {
    return headers;
  }

  const tokenHeaders = new Headers();
  const effectiveCookie = cookie || guestCookiesByBaseUrl.get(baseUrl) || '';

  if (effectiveCookie) {
    tokenHeaders.set('cookie', effectiveCookie);
  }

  const tokenResponse = await fetch(`${baseUrl}${cookie ? '/' : '/login'}`, {
    headers: tokenHeaders,
    redirect: 'manual',
  });
  const token = extractCsrfToken(await tokenResponse.text());

  if (!token) {
    throw new Error('Không thể tạo CSRF token cho E2E request.');
  }

  const refreshedCookie = getCookiePair(
    tokenResponse.headers.get('set-cookie') || '',
  );
  const requestCookie = cookie || refreshedCookie || effectiveCookie;

  if (!cookie && requestCookie) {
    guestCookiesByBaseUrl.set(baseUrl, requestCookie);
  }

  if (requestCookie) {
    headers.set('cookie', requestCookie);
  }

  headers.set('x-csrf-token', token);
  return headers;
};

module.exports = {
  extractCsrfToken,
  prepareCsrfHeaders,
};
