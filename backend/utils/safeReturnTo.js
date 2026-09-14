const MAX_RETURN_TO_LENGTH = 2048;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const hasUnsafePathCharacters = (value) =>
  value.startsWith('//') ||
  value.includes('\\') ||
  CONTROL_CHARACTER_PATTERN.test(value);

const isSafeReturnTo = (value) => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_RETURN_TO_LENGTH ||
    !value.startsWith('/') ||
    hasUnsafePathCharacters(value)
  ) {
    return false;
  }

  try {
    const decodedValue = decodeURIComponent(value);

    if (!decodedValue.startsWith('/') || hasUnsafePathCharacters(decodedValue)) {
      return false;
    }

    const parsedUrl = new URL(value, 'http://ntt-marketplace.internal');
    return parsedUrl.origin === 'http://ntt-marketplace.internal';
  } catch {
    return false;
  }
};

const safeReturnTo = (value, fallback = '/') =>
  isSafeReturnTo(value) ? value : fallback;

module.exports = {
  MAX_RETURN_TO_LENGTH,
  isSafeReturnTo,
  safeReturnTo,
};
