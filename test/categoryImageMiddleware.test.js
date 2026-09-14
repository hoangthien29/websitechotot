const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { after, before, test } = require('node:test');
const express = require('express');

const {
  MAX_CATEGORY_IMAGE_SIZE_BYTES,
  uploadCategoryImage,
} = require('../src/middlewares/categoryImage.middleware');
const {
  CATEGORY_IMAGE_UPLOAD_DIRECTORY,
  deleteStoredCategoryImage,
  uploadedCategoryImageToPublicPath,
} = require('../src/utils/categoryImageStorage');
const { createImageFixture } = require('../testSupport/imageFixtures');

let baseUrl;
let server;

const listen = (app) =>
  new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

const close = (instance) =>
  new Promise((resolve, reject) => {
    instance.close((error) => (error ? reject(error) : resolve()));
  });

const sendFiles = async (files) => {
  const form = new FormData();

  for (const file of files) {
    form.append(
      file.fieldName || 'image',
      new Blob([file.bytes], { type: file.type }),
      file.name,
    );
  }

  const response = await fetch(`${baseUrl}/category-image`, {
    method: 'POST',
    body: form,
  });

  return {
    body: await response.json(),
    status: response.status,
  };
};

const findFixtureContent = async (marker) => {
  const filenames = await fs.readdir(CATEGORY_IMAGE_UPLOAD_DIRECTORY);

  for (const filename of filenames) {
    const diskPath = path.join(CATEGORY_IMAGE_UPLOAD_DIRECTORY, filename);
    const content = await fs.readFile(diskPath).catch(() => null);

    if (content?.includes(marker)) {
      return true;
    }
  }

  return false;
};

before(async () => {
  const app = express();

  app.post('/category-image', uploadCategoryImage, (req, res) => {
    if (req.categoryImageUploadError) {
      return res.status(422).json(req.categoryImageUploadError);
    }

    return res.status(200).json({
      path: uploadedCategoryImageToPublicPath(req.file),
    });
  });

  server = await listen(app);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await close(server);
});

test('upload.single image nhận JPG, PNG và WEBP bằng UUID MIME', async () => {
  for (const fixture of [
    { name: 'category.anything', type: 'image/jpeg', extension: 'jpg' },
    { name: 'category.jpg', type: 'image/png', extension: 'png' },
    { name: 'category.svg', type: 'image/webp', extension: 'webp' },
  ]) {
    const result = await sendFiles([
      {
        ...fixture,
        bytes: createImageFixture(fixture.type),
      },
    ]);

    assert.equal(result.status, 200);
    assert.match(
      result.body.path,
      new RegExp(
        `^/uploads/categories/[0-9a-f-]+\\.${fixture.extension}$`,
        'i',
      ),
    );
    assert.equal(await deleteStoredCategoryImage(result.body.path), true);
  }
});

test('từ chối nội dung script giả MIME ảnh Category và cleanup file', async () => {
  const marker = Buffer.from('<script>category-payload</script>');
  const result = await sendFiles([
    {
      bytes: marker,
      name: 'category.jpg',
      type: 'image/jpeg',
    },
  ]);

  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'INVALID_CATEGORY_IMAGE_CONTENT');
  assert.equal(await findFixtureContent(marker), false);
});

test('từ chối ảnh lớn hơn 3 MB và không để file mồ côi', async () => {
  const marker = Buffer.from('oversized-category-marker');
  const bytes = Buffer.concat([
    marker,
    Buffer.alloc(
      MAX_CATEGORY_IMAGE_SIZE_BYTES + 1 - marker.length,
      65,
    ),
  ]);
  const result = await sendFiles([
    { bytes, name: 'large.jpg', type: 'image/jpeg' },
  ]);

  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'LIMIT_FILE_SIZE');
  assert.equal(
    result.body.message,
    'Ảnh danh mục không được vượt quá 3 MB.',
  );
  assert.equal(await findFixtureContent(marker), false);
});

test('từ chối SVG, PDF và không ghi file', async () => {
  for (const fixture of [
    {
      bytes: Buffer.from('<svg>invalid-category-marker</svg>'),
      name: 'category.svg',
      type: 'image/svg+xml',
    },
    {
      bytes: Buffer.from('%PDF-invalid-category-marker'),
      name: 'category.pdf',
      type: 'application/pdf',
    },
  ]) {
    const result = await sendFiles([fixture]);

    assert.equal(result.status, 422);
    assert.equal(result.body.code, 'INVALID_CATEGORY_IMAGE_TYPE');
    assert.equal(
      result.body.message,
      'Chỉ chấp nhận ảnh JPG, JPEG, PNG hoặc WEBP.',
    );
    assert.equal(
      await findFixtureContent(Buffer.from('invalid-category-marker')),
      false,
    );
  }
});

test('từ chối nhiều hơn một ảnh và dọn file đầu tiên', async () => {
  const marker = Buffer.from('multiple-category-marker');
  const result = await sendFiles([
    { bytes: marker, name: 'first.jpg', type: 'image/jpeg' },
    {
      bytes: Buffer.from('second-category'),
      name: 'second.jpg',
      type: 'image/jpeg',
    },
  ]);

  assert.equal(result.status, 422);
  assert.ok(
    ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(
      result.body.code,
    ),
  );
  assert.equal(
    result.body.message,
    'Chỉ được tải lên một ảnh danh mục.',
  );
  assert.equal(await findFixtureContent(marker), false);
});

test('từ chối field khác image', async () => {
  const marker = Buffer.from('wrong-category-field-marker');
  const result = await sendFiles([
    {
      bytes: marker,
      fieldName: 'images',
      name: 'wrong.jpg',
      type: 'image/jpeg',
    },
  ]);

  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'LIMIT_UNEXPECTED_FILE');
  assert.equal(
    result.body.message,
    'Chỉ được tải lên một ảnh danh mục.',
  );
  assert.equal(await findFixtureContent(marker), false);
});
