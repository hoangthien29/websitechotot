const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  MAX_RETURN_TO_LENGTH,
  isSafeReturnTo,
  safeReturnTo,
} = require('../src/utils/safeReturnTo');

test('safeReturnTo chấp nhận đường dẫn nội bộ và giữ query string', () => {
  const safePaths = [
    '/',
    '/listings',
    '/listings?page=2',
    '/listings?keyword=iphone',
    '/categories/dien-thoai',
    '/favorites',
    '/listings/507f1f77bcf86cd799439011',
  ];

  safePaths.forEach((path) => {
    assert.equal(isSafeReturnTo(path), true, path);
    assert.equal(safeReturnTo(path, '/fallback'), path);
  });
});

test('safeReturnTo chặn URL ngoài, backslash, ký tự điều khiển và path mã hóa nguy hiểm', () => {
  const unsafePaths = [
    'https://example.com',
    '//example.com',
    'javascript:alert(1)',
    '\\example.com',
    '/\\evil',
    '/%5cevil',
    '/%2f%2fexample.com',
    '/line\nbreak',
    '',
    ' /listings',
    'x'.repeat(MAX_RETURN_TO_LENGTH + 1),
  ];

  unsafePaths.forEach((path) => {
    assert.equal(isSafeReturnTo(path), false, path);
    assert.equal(safeReturnTo(path, '/fallback'), '/fallback');
  });

  assert.equal(safeReturnTo({ $ne: null }, '/fallback'), '/fallback');
  assert.equal(safeReturnTo(['/listings'], '/fallback'), '/fallback');
});
