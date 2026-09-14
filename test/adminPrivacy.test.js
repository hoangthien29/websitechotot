const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');

const read = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Admin services không query hoặc select nội dung Message', () => {
  const dashboard = read('src/services/adminDashboard.service.js');
  const users = read('src/services/adminUser.service.js');
  const listings = read('src/services/adminListing.service.js');
  const combined = `${dashboard}\n${users}\n${listings}`;

  assert.doesNotMatch(combined, /Message\.find(?:One|ById)?\s*\(/);
  assert.doesNotMatch(combined, /select\([^)]*content/);
  assert.doesNotMatch(combined, /populate\([^)]*content/);
  assert.match(combined, /Message\.countDocuments/);
});

test('Admin views không hiển thị password, session hoặc Message content', () => {
  const viewFiles = [
    'src/views/admin/dashboard.ejs',
    'src/views/admin/users/index.ejs',
    'src/views/admin/users/show.ejs',
    'src/views/admin/listings/index.ejs',
    'src/views/admin/listings/show.ejs',
  ];
  const views = viewFiles.map(read).join('\n');

  assert.doesNotMatch(views, /password|SESSION_SECRET|sessionId/i);
  assert.doesNotMatch(views, /message\.content|lastMessagePreview/);
  assert.match(views, /không tải hoặc hiển thị nội dung Message/i);
});

test('User và Listing Admin dùng select an toàn, không chọn password', () => {
  const users = read('src/services/adminUser.service.js');
  const listings = read('src/services/adminListing.service.js');

  assert.match(users, /SAFE_USER_SELECT/);
  assert.match(listings, /SAFE_LISTING_SELECT/);
  assert.doesNotMatch(users, /\+password/);
  assert.doesNotMatch(listings, /\+password/);
});
