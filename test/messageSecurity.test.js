const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ejs = require('ejs');

const ROOT = path.resolve(__dirname, '..');
const readSource = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('mọi EJS compile sau khi thêm Message', () => {
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
  assert.ok(compiledTemplates >= 31);
});

test('Message view chỉ escaped content và form không có identity field', () => {
  const showView = readSource('src/views/messages/show.ejs');

  assert.match(showView, /<%=\s*message\.content\s*%>/);
  assert.doesNotMatch(showView, /<%-\s*message\.content/);
  assert.doesNotMatch(
    showView,
    /name="(?:sender|recipient|buyer|seller|listing|readAt|role|status)"/,
  );
  assert.match(showView, /name="content"/);
  assert.match(showView, /maxlength="2000"/);
});

test('route Message luôn requireAuth, không có userId và mount trước 404', () => {
  const routes = readSource('src/routes/message.routes.js');
  const app = readSource('src/app.js');
  const staticIndex = app.indexOf('app.use(express.static');
  const unreadIndex = app.indexOf('app.use(loadUnreadMessageCount)');
  const messageRouteIndex = app.indexOf("app.use('/', messageRoutes)");
  const notFoundIndex = app.indexOf('app.use(notFoundMiddleware)');

  assert.match(routes, /router\.get\(\s*'\/messages',\s*requireAuth/s);
  assert.match(
    routes,
    /router\.get\(\s*'\/messages\/:conversationId',\s*requireAuth/s,
  );
  assert.match(
    routes,
    /router\.post\(\s*'\/listings\/:id\/conversations',\s*requireAuth/s,
  );
  assert.match(
    routes,
    /router\.post\(\s*'\/messages\/:conversationId',\s*requireAuth/s,
  );
  assert.doesNotMatch(routes, /userId/);
  assert.ok(staticIndex >= 0 && staticIndex < unreadIndex);
  assert.ok(messageRouteIndex >= 0 && messageRouteIndex < notFoundIndex);
});

test('Header, Listing detail và CSS giữ Favorite đồng thời tích hợp Message', () => {
  const header = readSource('src/views/partials/header.ejs');
  const detail = readSource('src/views/listings/show.ejs');
  const messageCss = readSource('src/public/css/messages.css');

  assert.match(header, /href="\/messages"/);
  assert.match(header, /99\+/);
  assert.match(header, /nav-unread-badge/);
  assert.match(detail, /favorites\/_favorite-button/);
  assert.match(detail, /Nhắn tin cho người bán/);
  assert.match(detail, /Tiếp tục trò chuyện/);
  assert.match(detail, /Đăng nhập để nhắn tin/);
  assert.doesNotMatch(detail, /name="(?:buyer|seller|sender|recipient)"/);
  assert.match(messageCss, /overflow-wrap:\s*anywhere/);
  assert.match(messageCss, /word-break:\s*break-word/);
  assert.match(messageCss, /white-space:\s*pre-wrap/);
  assert.match(messageCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(messageCss, /overflow-x:\s*hidden/);
  assert.doesNotMatch(messageCss, /#[0-9a-f]{3,8}/i);
});
