const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  CATEGORY_IMAGE_UPLOAD_DIRECTORY,
  categoryImagePublicPathToDiskPath,
  deleteStoredCategoryImage,
  getCategoryImageUrl,
  isManagedCategoryImagePath,
  uploadedCategoryImageToPublicPath,
} = require('../src/utils/categoryImageStorage');

const createdFiles = new Set();

const createFixture = async (directory, extension = 'jpg') => {
  const filename = `${crypto.randomUUID()}.${extension}`;
  const diskPath = path.join(directory, filename);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(diskPath, Buffer.from(`fixture-${filename}`));
  createdFiles.add(diskPath);

  return { diskPath, filename };
};

const exists = (filePath) =>
  fs.access(filePath).then(
    () => true,
    () => false,
  );

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

test('chỉ nhận Category image path UUID JPG, PNG hoặc WEBP', () => {
  const uuid = '123e4567-e89b-42d3-a456-426614174000';

  assert.equal(
    isManagedCategoryImagePath(`/uploads/categories/${uuid}.jpg`),
    true,
  );
  assert.equal(
    isManagedCategoryImagePath(`/uploads/categories/${uuid}.png`),
    true,
  );
  assert.equal(
    isManagedCategoryImagePath(`/uploads/categories/${uuid}.webp`),
    true,
  );

  for (const invalidPath of [
    `/uploads/categories/${uuid}.gif`,
    `/uploads/categories/not-a-uuid.jpg`,
    `/uploads/categories/nested/${uuid}.jpg`,
    `/uploads/categories/..\\${uuid}.jpg`,
    '/uploads/categories/../../.env',
    `/uploads/listings/${uuid}.jpg`,
    `/uploads/avatars/${uuid}.jpg`,
    '/images/category.svg',
    `C:\\uploads\\categories\\${uuid}.jpg`,
    `https://example.test/${uuid}.jpg`,
  ]) {
    assert.equal(isManagedCategoryImagePath(invalidPath), false);
  }
});

test('chuyển file Multer sang public path mà không tin originalname', () => {
  const filename = `${crypto.randomUUID()}.webp`;

  assert.equal(
    uploadedCategoryImageToPublicPath({
      filename,
      originalname: '../../attacker.svg',
    }),
    `/uploads/categories/${filename}`,
  );
  assert.equal(
    uploadedCategoryImageToPublicPath({ filename: '../bad.jpg' }),
    '',
  );
  assert.equal(uploadedCategoryImageToPublicPath(null), '');
  assert.equal(
    getCategoryImageUrl({
      image: `/uploads/categories/${filename}`,
    }),
    `/uploads/categories/${filename}`,
  );
  assert.equal(
    getCategoryImageUrl({
      image: 'https://example.test/image.jpg',
    }),
    '',
  );
});

test('disk path được resolve bên trong uploads/categories', () => {
  const publicPath =
    `/uploads/categories/${crypto.randomUUID()}.png`;
  const diskPath = categoryImagePublicPathToDiskPath(publicPath);

  assert.ok(diskPath);
  assert.equal(
    path.dirname(diskPath),
    path.resolve(CATEGORY_IMAGE_UPLOAD_DIRECTORY),
  );
  assert.equal(
    categoryImagePublicPathToDiskPath('/uploads/categories/../file.jpg'),
    null,
  );
  assert.equal(
    categoryImagePublicPathToDiskPath('/uploads/listings/file.jpg'),
    null,
  );
});

test('chỉ xóa Category image managed và ENOENT không làm lỗi', async () => {
  const categoryFixture = await createFixture(
    CATEGORY_IMAGE_UPLOAD_DIRECTORY,
  );
  const categoryPublicPath =
    `/uploads/categories/${categoryFixture.filename}`;

  assert.equal(await deleteStoredCategoryImage(categoryPublicPath), true);
  assert.equal(await deleteStoredCategoryImage(categoryPublicPath), false);
  assert.equal(await deleteStoredCategoryImage('/images/category.svg'), false);
});

test('không xóa file Listing, avatar hoặc file ngoài Category', async () => {
  const listingDirectory = path.resolve(
    __dirname,
    '..',
    'uploads',
    'listings',
  );
  const avatarDirectory = path.resolve(
    __dirname,
    '..',
    'uploads',
    'avatars',
  );
  const listing = await createFixture(listingDirectory);
  const avatar = await createFixture(avatarDirectory, 'png');

  assert.equal(
    await deleteStoredCategoryImage(
      `/uploads/listings/${listing.filename}`,
    ),
    false,
  );
  assert.equal(
    await deleteStoredCategoryImage(
      `/uploads/avatars/${avatar.filename}`,
    ),
    false,
  );
  assert.equal(await exists(listing.diskPath), true);
  assert.equal(await exists(avatar.diskPath), true);
});
