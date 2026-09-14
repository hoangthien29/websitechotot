const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { after, before, test } = require('node:test');

const express = require('express');
const session = require('express-session');

const {
  CSRF_ERROR_CODE,
  csrfProtection,
  isManagedMultipartMutation,
} = require('../src/config/csrf');
const {
  getPort,
  getTrustProxy,
  validateEnvironment,
} = require('../src/config/environment');
const {
  createApplicationRateLimiters,
  createRateLimiter,
} = require('../src/config/rateLimit');
const {
  getSessionCookieOptions,
  getSessionMaxAge,
} = require('../src/config/session');
const { attachCsrfToken } = require('../src/middlewares/csrf.middleware');
const {
  isValidImageSignature,
} = require('../src/utils/imageSignature');
const {
  buildPlan,
  getOptions,
  resolveAuditedFilePath,
} = require('../scripts/cleanupOrphans');
const { uploadNamespaces } = require('../scripts/auditData');

const ROOT = path.resolve(__dirname, '..');
const originalEnvironment = {
  MONGODB_URI: process.env.MONGODB_URI,
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  SESSION_MAX_AGE_MS: process.env.SESSION_MAX_AGE_MS,
  SESSION_SECRET: process.env.SESSION_SECRET,
  TRUST_PROXY: process.env.TRUST_PROXY,
};

const restoreEnvironment = () => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
};

after(restoreEnvironment);

const listen = (app) =>
  new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const getBaseUrl = (server) => {
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
};

const createCookieClient = (baseUrl) => {
  let cookie = '';

  return async (pathname, options = {}) => {
    const headers = new Headers(options.headers || {});

    if (cookie) {
      headers.set('cookie', cookie);
    }

    const response = await fetch(`${baseUrl}${pathname}`, {
      ...options,
      headers,
      redirect: 'manual',
    });
    const setCookie = response.headers.get('set-cookie');

    if (setCookie) {
      cookie = setCookie.split(';', 1)[0];
    }

    return response;
  };
};

let csrfBaseUrl;
let csrfServer;

before(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: 'step-13-unit-test-secret-with-enough-length',
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use(csrfProtection);
  app.use(attachCsrfToken);
  app.get('/form', (req, res) => res.type('text').send(res.locals.csrfToken));
  app.post('/mutation', (req, res) => res.sendStatus(204));
  app.use((error, req, res, next) => {
    if (error?.code === CSRF_ERROR_CODE) {
      res.sendStatus(403);
      return;
    }

    next(error);
  });

  csrfServer = await listen(app);
  csrfBaseUrl = getBaseUrl(csrfServer);
});

after(async () => {
  if (csrfServer) {
    await close(csrfServer);
  }
});

test('CSRF chấp nhận token đúng của session và từ chối token thiếu/sai', async () => {
  const client = createCookieClient(csrfBaseUrl);
  const token = await (await client('/form')).text();

  const accepted = await client('/mutation', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: token }),
  });
  assert.equal(accepted.status, 204);

  const missing = await client('/mutation', { method: 'POST' });
  assert.equal(missing.status, 403);

  const invalid = await client('/mutation', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: 'invalid-token' }),
  });
  assert.equal(invalid.status, 403);
});

test('CSRF token của session A không dùng được trong session B', async () => {
  const clientA = createCookieClient(csrfBaseUrl);
  const clientB = createCookieClient(csrfBaseUrl);
  const tokenA = await (await clientA('/form')).text();
  await clientB('/form');

  const response = await clientB('/mutation', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: tokenA }),
  });

  assert.equal(response.status, 403);
});

test('multipart chỉ skip global CSRF trên ba namespace upload được quản lý', async () => {
  const createRequest = (method, pathname, contentType = 'multipart/form-data') => ({
    method,
    path: pathname,
    is: (expected) => expected === contentType,
  });

  assert.equal(isManagedMultipartMutation(createRequest('PUT', '/profile')), true);
  assert.equal(isManagedMultipartMutation(createRequest('POST', '/listings')), true);
  assert.equal(
    isManagedMultipartMutation(
      createRequest('PUT', '/listings/507f1f77bcf86cd799439011'),
    ),
    true,
  );
  assert.equal(isManagedMultipartMutation(createRequest('POST', '/admin/categories')), true);
  assert.equal(
    isManagedMultipartMutation(
      createRequest('PUT', '/admin/categories/507f1f77bcf86cd799439011'),
    ),
    true,
  );
  assert.equal(isManagedMultipartMutation(createRequest('POST', '/logout')), false);
  assert.equal(isManagedMultipartMutation(createRequest('POST', '/messages/id')), false);

  const client = createCookieClient(csrfBaseUrl);
  await client('/form');
  const form = new FormData();
  form.append('value', 'multipart-without-token');
  const response = await client('/mutation', { body: form, method: 'POST' });
  assert.equal(response.status, 403);
});

test('rate limiter trả 429 và reset bằng window test ngắn', async () => {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'src', 'views'));
  app.locals.siteName = 'NTT Marketplace';
  app.locals.currentYear = new Date().getFullYear();
  app.use((req, res, next) => {
    res.locals.isAuthenticated = false;
    res.locals.currentUser = null;
    res.locals.unreadMessageCount = 0;
    next();
  });
  app.post(
    '/limited',
    createRateLimiter({ identifier: 'unit-test', limit: 2, windowMs: 80 }),
    (req, res) => res.sendStatus(204),
  );

  const server = await listen(app);
  const baseUrl = getBaseUrl(server);

  try {
    assert.equal((await fetch(`${baseUrl}/limited`, { method: 'POST' })).status, 204);
    assert.equal((await fetch(`${baseUrl}/limited`, { method: 'POST' })).status, 204);
    const limited = await fetch(`${baseUrl}/limited`, { method: 'POST' });
    assert.equal(limited.status, 429);
    assert.match(await limited.text(), /429/);

    await delay(100);
    assert.equal((await fetch(`${baseUrl}/limited`, { method: 'POST' })).status, 204);
  } finally {
    await close(server);
  }
});

test('auth, conversation, message và admin limiter đều trả 429 với config test riêng', async () => {
  const overrides = Object.fromEntries(
    ['auth', 'conversation', 'message', 'adminMutation'].map((name) => [
      name,
      { limit: 1, windowMs: 1000 },
    ]),
  );
  const limiters = createApplicationRateLimiters(overrides);
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'src', 'views'));
  app.locals.siteName = 'NTT Marketplace';
  app.locals.currentYear = new Date().getFullYear();
  app.use((req, res, next) => {
    res.locals.isAuthenticated = false;
    res.locals.currentUser = null;
    res.locals.unreadMessageCount = 0;
    next();
  });

  for (const [name, limiter] of Object.entries(limiters)) {
    app.post(`/${name}`, limiter, (req, res) => res.sendStatus(204));
  }

  const server = await listen(app);
  const baseUrl = getBaseUrl(server);

  try {
    for (const name of Object.keys(limiters)) {
      assert.equal((await fetch(`${baseUrl}/${name}`, { method: 'POST' })).status, 204);
      assert.equal((await fetch(`${baseUrl}/${name}`, { method: 'POST' })).status, 429);
    }
  } finally {
    await close(server);
  }
});

test('cookie session dùng httpOnly, SameSite=Lax và secure chỉ ở production', () => {
  process.env.SESSION_MAX_AGE_MS = '60000';
  process.env.NODE_ENV = 'development';
  assert.deepEqual(getSessionCookieOptions(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 60000,
    path: '/',
  });

  process.env.NODE_ENV = 'production';
  assert.equal(getSessionCookieOptions().secure, true);
  process.env.SESSION_MAX_AGE_MS = '-1';
  assert.throws(() => getSessionMaxAge(), /SESSION_MAX_AGE_MS/);
  restoreEnvironment();
});

test('production env từ chối secret yếu, port và trust proxy không hợp lệ', () => {
  process.env.NODE_ENV = 'production';
  process.env.MONGODB_URI = 'mongodb://example.invalid/database';
  process.env.SESSION_SECRET = 'short';
  process.env.PORT = '3000';
  process.env.TRUST_PROXY = '0';
  assert.throws(() => validateEnvironment(), /SESSION_SECRET/);

  process.env.SESSION_SECRET = 'a'.repeat(32);
  process.env.PORT = '70000';
  assert.throws(() => getPort(), /PORT/);
  process.env.PORT = '3000';
  process.env.TRUST_PROXY = 'true';
  assert.throws(() => getTrustProxy(), /TRUST_PROXY/);
  process.env.TRUST_PROXY = '1';
  assert.equal(validateEnvironment().trustProxy, 1);
  restoreEnvironment();
});

test('magic-byte chỉ nhận JPEG, PNG, WEBP khớp MIME', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const webp = Buffer.from('RIFF0000WEBP', 'ascii');
  const html = Buffer.from('<script>alert(1)</script>');

  assert.equal(isValidImageSignature(jpeg, 'image/jpeg'), true);
  assert.equal(isValidImageSignature(png, 'image/png'), true);
  assert.equal(isValidImageSignature(webp, 'image/webp'), true);
  assert.equal(isValidImageSignature(html, 'image/jpeg'), false);
  assert.equal(isValidImageSignature(jpeg, 'image/png'), false);
  assert.equal(isValidImageSignature(webp, 'image/svg+xml'), false);
});

test('mọi form mutation EJS đều include CSRF và không render raw dữ liệu', () => {
  const viewRoot = path.join(ROOT, 'src', 'views');
  const files = fs
    .readdirSync(viewRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ejs'))
    .map((entry) => path.join(entry.parentPath, entry.name));
  let mutationFormCount = 0;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const forms = source.match(/<form\b[\s\S]*?<\/form>/gi) || [];

    for (const form of forms) {
      if (/method=["']post["']/i.test(form)) {
        mutationFormCount += 1;
        assert.match(form, /include\([^)]*csrf/);
      }
    }

    const rawTags = source.match(/<%-[\s\S]*?%>/g) || [];
    for (const tag of rawTags) {
      assert.match(tag, /^<%-\s*include\(/);
    }
  }

  assert.ok(mutationFormCount >= 15);
});

test('multipart route kiểm tra CSRF sau upload để middleware lỗi cleanup được file', () => {
  const cases = [
    ['src/routes/profile.routes.js', 'uploadAvatar', 'multipartCsrfProtection'],
    ['src/routes/listing.routes.js', 'uploadListingImages', 'multipartCsrfProtection'],
    ['src/routes/adminCategory.routes.js', 'uploadCategoryImage', 'multipartCsrfProtection'],
  ];

  for (const [relativePath, uploadMiddleware, csrfMiddleware] of cases) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    assert.ok(source.indexOf(uploadMiddleware) < source.lastIndexOf(csrfMiddleware));
  }
});

test('audit orphan mặc định read-only và cleanup mặc định dry-run', () => {
  assert.deepEqual(getOptions([]), { apply: false, confirmed: false });
  assert.deepEqual(getOptions(['--apply']), { apply: true, confirmed: false });

  const plan = buildPlan({
    details: {
      orphanDocuments: [{ id: '507f1f77bcf86cd799439011', namespace: 'Favorite' }],
      orphanFiles: [{ namespace: 'avatars', path: '/uploads/avatars/example.jpg' }],
    },
  });

  assert.deepEqual(plan, {
    documents: [{ id: '507f1f77bcf86cd799439011', namespace: 'Favorite' }],
    files: [{ namespace: 'avatars', path: '/uploads/avatars/example.jpg' }],
  });

  const avatarNamespace = uploadNamespaces.find(
    (namespace) => namespace.namespace === 'avatars',
  );
  const safePath = resolveAuditedFilePath(
    avatarNamespace,
    '/uploads/avatars/123e4567-e89b-42d3-a456-426614174000.png',
  );
  assert.ok(safePath.startsWith(path.resolve(ROOT, 'uploads', 'avatars')));
  assert.equal(
    resolveAuditedFilePath(
      avatarNamespace,
      '/uploads/avatars/../../.env',
    ),
    null,
  );
});

test('app có Helmet chặt, body limit, healthz và graceful shutdown', () => {
  const appSource = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  assert.match(appSource, /app\.get\('\/healthz'/);
  assert.match(appSource, /express\.urlencoded\([\s\S]*limit: '32kb'/);
  assert.match(appSource, /express\.json\(\{ limit: '32kb'/);
  assert.match(appSource, /scriptSrc: \["'self'", 'https:\/\/cdn\.jsdelivr\.net'\]/);
  assert.match(appSource, /frameguard: \{ action: 'deny' \}/);
  assert.match(serverSource, /process\.once\('SIGINT'/);
  assert.match(serverSource, /process\.once\('SIGTERM'/);
  assert.match(serverSource, /closeSessionStore/);
  assert.match(serverSource, /mongoose\.disconnect/);
});
