const MIN_PRODUCTION_SESSION_SECRET_LENGTH = 32;
const DEFAULT_PORT = 3000;

const isProduction = () => process.env.NODE_ENV === 'production';

const getPort = () => {
  const rawPort = process.env.PORT;

  if (!rawPort) {
    return DEFAULT_PORT;
  }

  const port = Number(rawPort);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT phải là số nguyên từ 1 đến 65535.');
  }

  return port;
};

const getTrustProxy = () => {
  const rawValue = String(process.env.TRUST_PROXY || '').trim();

  if (!rawValue || rawValue === '0' || rawValue.toLowerCase() === 'false') {
    return false;
  }

  const hopCount = Number(rawValue);

  if (!Number.isSafeInteger(hopCount) || hopCount < 1 || hopCount > 10) {
    throw new Error('TRUST_PROXY phải là false, 0 hoặc số nguyên từ 1 đến 10.');
  }

  return hopCount;
};

const validateEnvironment = () => {
  const missingVariables = ['MONGODB_URI', 'SESSION_SECRET'].filter(
    (name) => !process.env[name],
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Thiếu biến môi trường bắt buộc: ${missingVariables.join(', ')}.`,
    );
  }

  if (
    isProduction() &&
    process.env.SESSION_SECRET.length < MIN_PRODUCTION_SESSION_SECRET_LENGTH
  ) {
    throw new Error(
      `SESSION_SECRET production phải có ít nhất ${MIN_PRODUCTION_SESSION_SECRET_LENGTH} ký tự.`,
    );
  }

  return {
    port: getPort(),
    trustProxy: getTrustProxy(),
  };
};

module.exports = {
  DEFAULT_PORT,
  MIN_PRODUCTION_SESSION_SECRET_LENGTH,
  getPort,
  getTrustProxy,
  isProduction,
  validateEnvironment,
};
