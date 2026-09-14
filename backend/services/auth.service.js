const bcrypt = require('bcrypt');

const User = require('../models/User');

const BCRYPT_SALT_ROUNDS = 12;
const EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS';
const EMAIL_ALREADY_EXISTS_MESSAGE =
  'Email này đã được sử dụng. Vui lòng chọn email khác.';
const INVALID_CREDENTIALS = 'INVALID_CREDENTIALS';
const INVALID_CREDENTIALS_MESSAGE = 'Email hoặc mật khẩu không đúng.';
const ACCOUNT_BLOCKED = 'ACCOUNT_BLOCKED';
const ACCOUNT_BLOCKED_MESSAGE = 'Tài khoản của bạn đã bị khóa.';
const ACCOUNT_PENDING = 'ACCOUNT_PENDING';
const ACCOUNT_PENDING_MESSAGE = 'Tài khoản của bạn chưa được kích hoạt.';

const createEmailAlreadyExistsError = () => {
  const error = new Error(EMAIL_ALREADY_EXISTS_MESSAGE);
  error.code = EMAIL_ALREADY_EXISTS;
  return error;
};

const createAuthError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const registerUser = async (data) => {
  const { name, email, password } = data;
  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await User.findOne({ email: normalizedEmail }).select('_id');

  if (existingUser) {
    throw createEmailAlreadyExistsError();
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  try {
    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      password: hashedPassword,
      role: 'user',
      status: 'active',
    });

    return { userId: user._id };
  } catch (error) {
    if (error.code === 11000) {
      throw createEmailAlreadyExistsError();
    }

    throw error;
  }
};

const authenticateUser = async ({ email, password }) => {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select('+password');

  if (!user) {
    throw createAuthError(INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE);
  }

  const passwordMatches = await bcrypt.compare(password, user.password);

  if (!passwordMatches) {
    throw createAuthError(INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE);
  }

  if (user.status === 'blocked') {
    throw createAuthError(ACCOUNT_BLOCKED, ACCOUNT_BLOCKED_MESSAGE);
  }

  if (user.status === 'pending') {
    throw createAuthError(ACCOUNT_PENDING, ACCOUNT_PENDING_MESSAGE);
  }

  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    role: user.role,
    status: user.status,
  };
};

module.exports = {
  ACCOUNT_BLOCKED,
  ACCOUNT_BLOCKED_MESSAGE,
  ACCOUNT_PENDING,
  ACCOUNT_PENDING_MESSAGE,
  BCRYPT_SALT_ROUNDS,
  EMAIL_ALREADY_EXISTS,
  EMAIL_ALREADY_EXISTS_MESSAGE,
  INVALID_CREDENTIALS,
  INVALID_CREDENTIALS_MESSAGE,
  authenticateUser,
  registerUser,
};
