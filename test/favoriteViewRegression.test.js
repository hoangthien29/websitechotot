const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ejs = require('ejs');

const ROOT = path.resolve(__dirname, '..');
const readSource = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('mọi EJS compile được sau khi thêm Favorite', () => {
  const viewsRoot = path.join(ROOT, 'src', 'views');
  let compiledTemplates = 0;

  const walk = (directory) => {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(absolutePath);
        return;
      }

      if (entry.name.endsWith('.ejs')) {
        ejs.compile(fs.readFileSync(absolutePath, 'utf8'), {
          filename: absolutePath,
        });
        compiledTemplates += 1;
      }
    });
  };

  walk(viewsRoot);
  assert.ok(compiledTemplates >= 28);
});

test('Favorite button render form hợp lệ, escaped returnTo và aria-label', async () => {
  const templatePath = path.join(
    ROOT,
    'src',
    'views',
    'favorites',
    '_favorite-button.ejs',
  );
  const listing = {
    _id: '507f1f77bcf86cd799439011',
    seller: { _id: '507f191e810c19729de860ea' },
    isFavorited: true,
  };
  const html = await ejs.renderFile(templatePath, {
    listing,
    currentUser: { _id: '507f191e810c19729de860eb' },
    returnTo: '/listings?keyword=&quot;bad&quot;',
    compact: true,
    isFavorited: true,
  });

  assert.match(html, /_method=DELETE/);
  assert.match(html, /aria-label="Bỏ lưu sản phẩm"/);
  assert.match(html, /name="returnTo"/);
  assert.doesNotMatch(html, /value="\/listings\?keyword="bad""/);
  assert.equal((html.match(/<form/g) || []).length, 1);
  assert.equal((html.match(/<button/g) || []).length, 1);
});

test('card, detail, Header và app cùng nối đúng Favorite route/partial', () => {
  const card = readSource('src/views/listings/_card.ejs');
  const detail = readSource('src/views/listings/show.ejs');
  const header = readSource('src/views/partials/header.ejs');
  const routes = readSource('src/routes/favorite.routes.js');
  const app = readSource('src/app.js');

  assert.match(card, /favorites\/_favorite-button/);
  assert.match(detail, /favorites\/_favorite-button/);
  assert.match(header, /href="\/favorites"/);
  assert.match(routes, /router\.get\(\s*'\/favorites'/);
  assert.match(routes, /router\.post\(\s*'\/listings\/:id\/favorite'/);
  assert.match(routes, /router\.delete\(\s*'\/listings\/:id\/favorite'/);
  assert.doesNotMatch(routes, /users\/:userId/);
  assert.ok(
    app.indexOf("app.use('/', favoriteRoutes)") <
      app.indexOf('app.use(notFoundMiddleware)'),
  );
});
