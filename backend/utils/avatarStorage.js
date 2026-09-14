const fs = require('node:fs/promises');
const path = require('node:path');

const AVATAR_UPLOAD_DIRECTORY = path.resolve(
  __dirname,
  '..',
  '..',
  'uploads',
  'avatars',
);
const AVATAR_UPLOAD_PUBLIC_PREFIX = '/uploads/avatars/';
const AVATAR_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

const isManagedAvatarPath = (publicPath) => {
  if (
    typeof publicPath !== 'string' ||
    !publicPath.startsWith(AVATAR_UPLOAD_PUBLIC_PREFIX)
  ) {
    return false;
  }

  const filename = publicPath.slice(AVATAR_UPLOAD_PUBLIC_PREFIX.length);

  return (
    AVATAR_FILENAME_PATTERN.test(filename) &&
    filename === path.basename(filename) &&
    !filename.includes('\\')
  );
};

const uploadedAvatarToPublicPath = (file) => {
  const filename = path.basename(file?.filename || '');
  const publicPath = filename
    ? `${AVATAR_UPLOAD_PUBLIC_PREFIX}${filename}`
    : '';

  return isManagedAvatarPath(publicPath) ? publicPath : '';
};

const avatarPublicPathToDiskPath = (publicPath) => {
  if (!isManagedAvatarPath(publicPath)) {
    return null;
  }

  const filename = publicPath.slice(AVATAR_UPLOAD_PUBLIC_PREFIX.length);
  const diskPath = path.resolve(AVATAR_UPLOAD_DIRECTORY, filename);
  const allowedPrefix = `${AVATAR_UPLOAD_DIRECTORY}${path.sep}`;

  return diskPath.startsWith(allowedPrefix) ? diskPath : null;
};

const deleteStoredAvatar = async (publicPath) => {
  const diskPath = avatarPublicPathToDiskPath(publicPath);

  if (!diskPath) {
    return false;
  }

  try {
    await fs.unlink(diskPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    console.warn(
      `Không thể xóa file ảnh đại diện đã lưu (${error.code || 'UnknownError'}).`,
    );
    return false;
  }
};

module.exports = {
  AVATAR_UPLOAD_DIRECTORY,
  AVATAR_UPLOAD_PUBLIC_PREFIX,
  avatarPublicPathToDiskPath,
  deleteStoredAvatar,
  isManagedAvatarPath,
  uploadedAvatarToPublicPath,
};
