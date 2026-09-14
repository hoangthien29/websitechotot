const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const readSource = (...segments) =>
  fs.readFileSync(path.resolve(__dirname, '..', ...segments), 'utf8');

test('Admin Category route đặt auth/admin trước upload/validator/controller', () => {
  const source = readSource('src', 'routes', 'adminCategory.routes.js');
  const authIndex = source.indexOf('router.use(requireAuth)');
  const adminIndex = source.indexOf('router.use(requireAdmin)');
  const createRouteIndex = source.indexOf("router.post(\n  '/'");
  const uploadIndex = source.indexOf(
    'uploadCategoryImage,',
    createRouteIndex,
  );
  const validatorIndex = source.indexOf(
    'createCategoryValidator,',
    createRouteIndex,
  );
  const controllerIndex = source.indexOf(
    'categoryController.createCategory',
  );

  assert.ok(authIndex >= 0);
  assert.ok(adminIndex > authIndex);
  assert.ok(uploadIndex > adminIndex);
  assert.ok(validatorIndex > uploadIndex);
  assert.ok(controllerIndex > validatorIndex);
  assert.equal(/router\.(delete|get)\([^)]*image/i.test(source), false);
});

test('form Category là multipart file image, không còn input URL', () => {
  const form = readSource(
    'src',
    'views',
    'admin',
    'categories',
    '_form.ejs',
  );

  assert.match(form, /enctype="multipart\/form-data"/);
  assert.match(form, /name="image"[\s\S]{0,120}type="file"/);
  assert.match(form, /name="removeImage"/);
  assert.doesNotMatch(
    form,
    /type="text"[\s\S]{0,160}name="image"/,
  );
  assert.match(form, /tối đa 3 MB/i);
  assert.match(form, /16:9/);
});

test('public Category chỉ render managed imageUrl hoặc icon fallback', () => {
  const index = readSource('src', 'views', 'categories', 'index.ejs');
  const show = readSource('src', 'views', 'categories', 'show.ejs');

  assert.match(index, /category\.hasManagedImage/);
  assert.match(index, /src="<%= category\.imageUrl %>"/);
  assert.match(index, /loading="lazy"/);
  assert.match(index, /category-card-link/);
  assert.match(index, /Xem sản phẩm/);
  assert.doesNotMatch(index, /<a class="btn btn-primary/);
  assert.match(show, /category\.hasManagedImage/);
  assert.match(show, /category-card__icon--large/);
});

test('Home tiếp tục dùng icon compact và không render Category image', () => {
  const home = readSource('src', 'views', 'home.ejs');

  assert.match(home, /home-category-icon/);
  assert.match(home, /categories\/_icon/);
  assert.doesNotMatch(home, /category\.image/);
});

test('static middleware chỉ mount uploads, Helmet vẫn được bật', () => {
  const app = readSource('src', 'app.js');

  assert.match(app, /helmet\(/);
  assert.match(app, /app\.use\(\s*['"]\/uploads['"]/);
  assert.doesNotMatch(app, /express\.static\(__dirname\)/);
  assert.doesNotMatch(app, /express\.static\(\s*process\.cwd\(\)\s*\)/);
});
