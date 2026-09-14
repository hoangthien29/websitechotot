const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  AVATAR_UPLOAD_DIRECTORY,
  avatarPublicPathToDiskPath,
  deleteStoredAvatar,
  isManagedAvatarPath,
  uploadedAvatarToPublicPath,
} = require('../src/utils/avatarStorage');

const createdFiles = new Set();

const createManagedFixture = async (extension = 'jpg') => {
  const filename = `${crypto.randomUUID()}.${extension}`;
  const diskPath = path.join(AVATAR_UPLOAD_DIRECTORY, filename);
  const publicPath = `/uploads/avatars/${filename}`;

  await fs.mkdir(AVATAR_UPLOAD_DIRECTORY, { recursive: true });
  await fs.writeFile(diskPath, Buffer.from('ntt-avatar-fixture'));
  createdFiles.add(diskPath);

  return { diskPath, filename, publicPath };
};

afterEach(async () => {
  await Promise.all(
    [...createdFiles].map((filePath) =>
      fs.unlink(filePath).catch((error) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }),
    ),
  );
  createdFiles.clear();
});

test('chỉ nhận public path avatar UUID do ứng dụng quản lý', () => {
  const validUuid = '123e4567-e89b-42d3-a456-426614174000';

  assert.equal(
    isManagedAvatarPath(`/uploads/avatars/${validUuid}.jpg`),
    true,
  );
  assert.equal(
    isManagedAvatarPath(`/uploads/avatars/${validUuid}.png`),
    true,
  );
  assert.equal(
    isManagedAvatarPath(`/uploads/avatars/${validUuid}.webp`),
    true,
  );
  assert.equal(isManagedAvatarPath('/images/default-avatar.svg'), false);
  assert.equal(
    isManagedAvatarPath(`/uploads/listings/${validUuid}.jpg`),
    false,
  );
  assert.equal(
    isManagedAvatarPath('/uploads/avatars/../../.env'),
    false,
  );
  assert.equal(
    isManagedAvatarPath(`C:\\uploads\\avatars\\${validUuid}.jpg`),
    false,
  );
  assert.equal(
    isManagedAvatarPath(`/uploads/avatars/nested/${validUuid}.jpg`),
    false,
  );
});

test('chuyển file Multer thành public path mà không dùng originalname', () => {
  const filename = `${crypto.randomUUID()}.webp`;

  assert.equal(
    uploadedAvatarToPublicPath({
      filename,
      originalname: '../../listing.jpg',
    }),
    `/uploads/avatars/${filename}`,
  );
  assert.equal(uploadedAvatarToPublicPath({ filename: '../bad.jpg' }), '');
  assert.equal(uploadedAvatarToPublicPath(null), '');
});

test('disk path luôn nằm trong uploads/avatars', () => {
  const publicPath = `/uploads/avatars/${crypto.randomUUID()}.png`;
  const diskPath = avatarPublicPathToDiskPath(publicPath);

  assert.ok(diskPath);
  assert.equal(
    path.dirname(diskPath),
    path.resolve(AVATAR_UPLOAD_DIRECTORY),
  );
  assert.equal(avatarPublicPathToDiskPath('/uploads/listings/file.jpg'), null);
  assert.equal(avatarPublicPathToDiskPath('/uploads/avatars/../file.jpg'), null);
});

test('xóa đúng avatar managed và coi ENOENT là an toàn', async () => {
  const fixture = await createManagedFixture();

  assert.equal(await deleteStoredAvatar(fixture.publicPath), true);
  assert.equal(await deleteStoredAvatar(fixture.publicPath), false);
  assert.equal(await deleteStoredAvatar('/images/default-avatar.svg'), false);
  assert.equal(
    await deleteStoredAvatar(
      `/uploads/listings/${crypto.randomUUID()}.jpg`,
    ),
    false,
  );
});
