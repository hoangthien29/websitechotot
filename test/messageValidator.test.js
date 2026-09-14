const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validationResult } = require('express-validator');

const {
  conversationIdValidator,
  conversationsPageValidator,
  listingConversationValidator,
  messagesPageValidator,
  sendMessageValidator,
} = require('../src/validators/message.validator');

const runValidators = async (validators, req) => {
  const middleware = Array.isArray(validators) ? validators : [validators];

  for (const validator of middleware) {
    await new Promise((resolve, reject) => {
      validator(req, {}, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  return validationResult(req);
};

test('validator Conversation và Listing chỉ nhận scalar ObjectId', async () => {
  const validId = '507f1f77bcf86cd799439011';

  for (const [validators, field] of [
    [conversationIdValidator, 'conversationId'],
    [listingConversationValidator, 'id'],
  ]) {
    const validResult = await runValidators(validators, {
      params: { [field]: validId },
      query: {},
      body: {},
    });
    assert.equal(validResult.isEmpty(), true);

    for (const value of ['sai-id', '', [validId], { $ne: null }]) {
      const result = await runValidators(validators, {
        params: { [field]: value },
        query: {},
        body: {},
      });
      assert.equal(result.isEmpty(), false, `${field}: ${String(value)}`);
    }
  }
});

test('validator Message trim nội dung, giới hạn 2.000 và bỏ qua field giả', async () => {
  const validRequest = {
    params: {},
    query: {},
    body: {
      content: '  Xin chào người bán  ',
      sender: '507f1f77bcf86cd799439012',
      recipient: '507f1f77bcf86cd799439013',
      role: 'admin',
    },
  };
  const validResult = await runValidators(
    sendMessageValidator,
    validRequest,
  );

  assert.equal(validResult.isEmpty(), true);
  assert.equal(validRequest.body.content, 'Xin chào người bán');

  for (const content of ['', '   ', 'a'.repeat(2001), [], { $gt: '' }]) {
    const result = await runValidators(sendMessageValidator, {
      params: {},
      query: {},
      body: { content },
    });
    assert.equal(result.isEmpty(), false);
  }
});

test('hai validator page chỉ nhận integer scalar 1–10.000 và từ chối field lạ', async () => {
  for (const validators of [
    conversationsPageValidator,
    messagesPageValidator,
  ]) {
    for (const page of [undefined, '1', '10000']) {
      const result = await runValidators(validators, {
        params: {},
        query: page === undefined ? {} : { page },
        body: {},
      });
      assert.equal(result.isEmpty(), true, String(page));
    }

    for (const page of ['0', '-1', 'abc', '1.5', '10001', ['1'], { $gt: 0 }]) {
      const result = await runValidators(validators, {
        params: {},
        query: { page },
        body: {},
      });
      assert.equal(result.isEmpty(), false, String(page));
    }

    const unknownResult = await runValidators(validators, {
      params: {},
      query: { page: '1', userId: '507f1f77bcf86cd799439011' },
      body: {},
    });
    assert.equal(unknownResult.isEmpty(), false);
  }
});
