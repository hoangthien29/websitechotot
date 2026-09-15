const assert = require('node:assert/strict');
const { test } = require('node:test');

const authService = require('../backend/services/auth.service');
const authController = require('../backend/controllers/auth.controller');
const User = require('../backend/models/User');

test('authService.findOrCreateGoogleUser tạo user mới từ Google', async (t) => {
  const profile = {
    email: 'newgoogle@example.com',
    name: 'Google User',
    picture: 'https://lh3.googleusercontent.com/a/abc',
  };

  t.mock.method(User, 'findOne', () => ({
    select: async () => null,
  }));
  t.mock.method(User, 'create', async (payload) => ({
    _id: 'google-user-id',
    ...payload,
  }));

  const result = await authService.findOrCreateGoogleUser(profile);

  assert.equal(result.created, true);
  assert.equal(result.user.email, 'newgoogle@example.com');
  assert.equal(result.user.name, 'Google User');
  assert.equal(result.user.role, 'user');
  assert.equal(result.user.status, 'active');
});

test('authController.googleLogin redirect tới Google OAuth', () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = 'google-client-id-test';

  const res = {
    redirect(status, url) {
      this.statusCode = status;
      this.url = url;
      return this;
    },
  };

  try {
    authController.googleLogin({}, res);

    assert.equal(res.statusCode, 303);
    assert.match(res.url, /accounts\.google\.com/);
    assert.match(res.url, /client_id=/);
    assert.match(res.url, /redirect_uri=/);
    assert.match(res.url, /scope=/);
  } finally {
    if (previousClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = previousClientId;
    }
  }
});
