const fs = require('node:fs/promises');

const SIGNATURE_SIZE_BYTES = 12;

const hasPrefix = (buffer, signature) =>
  buffer.length >= signature.length &&
  signature.every((byte, index) => buffer[index] === byte);

const isValidImageSignature = (buffer, mimeType) => {
  if (!Buffer.isBuffer(buffer)) {
    return false;
  }

  if (mimeType === 'image/jpeg') {
    return hasPrefix(buffer, [0xff, 0xd8, 0xff]);
  }

  if (mimeType === 'image/png') {
    return hasPrefix(buffer, [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  }

  if (mimeType === 'image/webp') {
    return (
      buffer.length >= SIGNATURE_SIZE_BYTES &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }

  return false;
};

const validateUploadedImageFile = async (file) => {
  if (!file?.path || typeof file.mimetype !== 'string') {
    return false;
  }

  const handle = await fs.open(file.path, 'r');

  try {
    const buffer = Buffer.alloc(SIGNATURE_SIZE_BYTES);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      SIGNATURE_SIZE_BYTES,
      0,
    );

    return isValidImageSignature(buffer.subarray(0, bytesRead), file.mimetype);
  } finally {
    await handle.close();
  }
};

module.exports = {
  SIGNATURE_SIZE_BYTES,
  isValidImageSignature,
  validateUploadedImageFile,
};
