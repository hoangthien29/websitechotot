const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { after, before, test } = require('node:test');
const express = require('express');

const {
  MAX_AVATAR_SIZE_BYTES,
  uploadAvatar,
} = require('../src/middlewares/avatar.middleware');
const {
  AVATAR_UPLOAD_DIRECTORY,
  deleteStoredAvatar,
  uploadedAvatarToPublicPath,
} = require('../src/utils/avatarStorage');
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
      file.fieldName || 'avatar',
      new Blob([file.bytes], { type: file.type }),
      file.name,
    );
  }

  const response = await fetch(`${baseUrl}/avatar`, {
    method: 'PUT',
    body: form,
  });

  return {
    body: await response.json(),
    status: response.status,
  };
};

const findFixtureContent = async (marker) => {
  const filenames = await fs.readdir(AVATAR_UPLOAD_DIRECTORY);

  for (const filename of filenames) {
    const diskPath = path.join(AVATAR_UPLOAD_DIRECTORY, filename);
    const content = await fs.readFile(diskPath).catch(() => null);

    if (content?.includes(marker)) {
      return true;
    }
  }

  return false;
};

before(async () => {
  const app = express();

  app.put('/avatar', uploadAvatar, (req, res) => {
    if (req.avatarUploadError) {
      return res.status(422).json({
        code: req.avatarUploadError.code,
        message: req.avatarUploadError.message,
      });
    }

    return res.status(200).json({
      path: uploadedAvatarToPublicPath(req.file),
    });
  });

  server = await listen(app);
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await close(server);
});

test('upload.single avatar nhận JPG, PNG và WEBP', async () => {
  for (const fixture of [
    { name: 'avatar.jpg', type: 'image/jpeg' },
    { name: 'avatar.png', type: 'image/png' },
    { name: 'avatar.webp', type: 'image/webp' },
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
      /^\/uploads\/avatars\/[0-9a-f-]+\.(jpg|png|webp)$/i,
    );
    assert.equal(await deleteStoredAvatar(result.body.path), true);
  }
});

test('từ chối HTML hoặc JavaScript giả MIME ảnh và cleanup file', async () => {
  for (const fixture of [
    {
      bytes: Buffer.from('<script>alert(1)</script>'),
      name: 'payload.jpg',
      type: 'image/jpeg',
    },
    {
      bytes: Buffer.from('console.log("payload")'),
      name: 'payload.png',
      type: 'image/png',
    },
  ]) {
    const result = await sendFiles([fixture]);

    assert.equal(result.status, 422);
    assert.equal(result.body.code, 'INVALID_AVATAR_CONTENT');
    assert.equal(await findFixtureContent(fixture.bytes), false);
  }
});

test('từ chối avatar lớn hơn 2 MB và không để file mồ côi', async () => {
  const marker = Buffer.from('oversized-avatar-marker');
  const bytes = Buffer.concat([
    marker,
    Buffer.alloc(MAX_AVATAR_SIZE_BYTES + 1 - marker.length, 65),
  ]);
  const result = await sendFiles([
    { bytes, name: 'large.jpg', type: 'image/jpeg' },
  ]);

  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'LIMIT_FILE_SIZE');
  assert.equal(
    result.body.message,
    'Ảnh đại diện không được vượt quá 2 MB.',
  );
  assert.equal(await findFixtureContent(marker), false);
});

test('từ chối SVG/PDF và không ghi file', async () => {
  for (const fixture of [
    {
      bytes: Buffer.from('<svg>invalid-avatar</svg>'),
      name: 'avatar.svg',
      type: 'image/svg+xml',
    },
    {
      bytes: Buffer.from('%PDF-invalid-avatar'),
      name: 'avatar.pdf',
      type: 'application/pdf',
    },
  ]) {
    const result = await sendFiles([fixture]);

    assert.equal(result.status, 422);
    assert.equal(result.body.code, 'INVALID_AVATAR_TYPE');
    assert.equal(
      result.body.message,
      'Chỉ chấp nhận ảnh JPG, JPEG, PNG hoặc WEBP.',
    );
    assert.equal(
      await findFixtureContent(Buffer.from('invalid-avatar')),
      false,
    );
  }
});

test('từ chối nhiều hơn một avatar và dọn file đầu tiên', async () => {
  const marker = Buffer.from('multiple-avatar-unique-marker');
  const result = await sendFiles([
    {
      bytes: marker,
      name: 'first.jpg',
      type: 'image/jpeg',
    },
    {
      bytes: Buffer.from('second-avatar'),
      name: 'second.jpg',
      type: 'image/jpeg',
    },
  ]);

  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'LIMIT_FILE_COUNT');
  assert.equal(
    result.body.message,
    'Chỉ được tải lên một ảnh đại diện.',
  );
  assert.equal(await findFixtureContent(marker), false);
});

test('từ chối field upload khác avatar bằng LIMIT_UNEXPECTED_FILE', async () => {
  const marker = Buffer.from('unexpected-avatar-field-marker');
  const result = await sendFiles([
    {
      bytes: marker,
      fieldName: 'images',
      name: 'wrong-field.jpg',
      type: 'image/jpeg',
    },
  ]);

  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'LIMIT_UNEXPECTED_FILE');
  assert.equal(
    result.body.message,
    'Chỉ được tải lên một ảnh đại diện.',
  );
  assert.equal(await findFixtureContent(marker), false);
});
