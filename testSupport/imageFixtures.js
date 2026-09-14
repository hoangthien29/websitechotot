const SIGNATURES = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  'image/png': Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]),
  'image/webp': Buffer.from('RIFF0000WEBP', 'ascii'),
};

const createImageFixture = (mimeType, payload = 'fixture') => {
  const signature = SIGNATURES[mimeType];

  if (!signature) {
    throw new Error(`Unsupported fixture MIME: ${mimeType}`);
  }

  return Buffer.concat([signature, Buffer.from(payload)]);
};

module.exports = {
  createImageFixture,
};
