const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { requireAdmin } = require('../src/middlewares/admin.middleware');

const ROOT = path.resolve(__dirname, '..');

const createResponse = () => ({
  statusCode: 200,
  redirectStatus: null,
  view: '',
  status(code) {
    this.statusCode = code;
    return this;
  },
  redirect(status) {
    this.redirectStatus = status;
    return this;
  },
  render(view) {
    this.view = view;
    return this;
  },
});

test('requireAdmin chỉ cho active admin và giữ convention guest/user', () => {
  const guest = createResponse();
  requireAdmin({ user: null }, guest, assert.fail);
  assert.equal(guest.redirectStatus, 303);

  const user = createResponse();
  requireAdmin(
    { user: { role: 'user', status: 'active' } },
    user,
    assert.fail,
  );
  assert.equal(user.statusCode, 403);

  const blockedAdmin = createResponse();
  requireAdmin(
    { user: { role: 'admin', status: 'blocked' } },
    blockedAdmin,
    assert.fail,
  );
  assert.equal(blockedAdmin.statusCode, 403);

  let nextCalled = false;
  requireAdmin(
    { user: { role: 'admin', status: 'active' } },
    createResponse(),
    () => {
      nextCalled = true;
    },
  );
  assert.equal(nextCalled, true);
});

test('Admin routes theo thứ tự auth/admin/validator và không có hard delete', () => {
  const routes = fs.readFileSync(
    path.join(ROOT, 'src/routes/admin.routes.js'),
    'utf8',
  );
  const app = fs.readFileSync(
    path.join(ROOT, 'src/app.js'),
    'utf8',
  );

  assert.match(
    routes,
    /router\.use\(requireAuth\);\s*router\.use\(requireAdmin\);/s,
  );
  assert.match(routes, /router\.get\('\/', adminDashboardController/);
  assert.match(routes, /router\.patch\(\s*'\/users\/:id\/block'/s);
  assert.match(routes, /router\.patch\(\s*'\/listings\/:id\/hide'/s);
  assert.doesNotMatch(routes, /router\.delete/);
  assert.doesNotMatch(routes, /role|messages\/:id/i);
  assert.ok(
    app.indexOf("app.use('/admin', adminRoutes)") <
      app.indexOf('app.use(notFoundMiddleware)'),
  );
});
