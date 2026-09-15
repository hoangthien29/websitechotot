const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');

const Message = require('../backend/models/Message');
const messageService = require('../backend/services/message.service');
const messageController = require('../backend/controllers/message.controller');
const conversationService = require('../backend/services/conversation.service');
const socketModule = require('../backend/socket/socket');
const Listing = require('../backend/models/Listing');
const Conversation = require('../backend/models/Conversation');

const createMessageQuery = (value) => ({
  select() { return this; },
  populate() { return this; },
  sort() { return this; },
  skip() { return this; },
  limit() { return this; },
  session() { return this; },
  lean() { return Promise.resolve(value); },
});

test('Message schema hỗ trợ attachments media và thumbnail', () => {
  assert.ok(Message.schema.path('attachments'));
  assert.equal(Message.schema.path('attachments').instance, 'Array');
  assert.equal(Message.schema.path('attachments').schema.path('type').enumValues.includes('image'), true);
  assert.equal(Message.schema.path('attachments').schema.path('type').enumValues.includes('video'), true);
});

test('sendMessage cho phép content rỗng khi có attachments', async (t) => {
  const conversationId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId();
  const buyerId = new mongoose.Types.ObjectId();
  const sellerId = new mongoose.Types.ObjectId();

  const session = {
    async withTransaction(fn) { await fn(); },
    async endSession() {},
  };

  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Listing, 'findById', () => createMessageQuery({ _id: listingId, status: 'active' }));
  t.mock.method(Conversation, 'updateOne', async () => ({ matchedCount: 1 }));
  t.mock.method(Message, 'create', async (rows) => [{
    ...rows[0],
    _id: new mongoose.Types.ObjectId(),
    createdAt: new Date(),
  }]);

  await messageService.sendMessage({
    conversation: {
      _id: conversationId,
      listing: { _id: listingId },
      buyer: { _id: buyerId },
      seller: { _id: sellerId },
    },
    senderId: buyerId,
    content: '',
    attachments: [
      { type: 'image', url: '/uploads/messages/demo.jpg', thumbnail: '/uploads/messages/demo-thumb.jpg' },
      { type: 'video', url: '/uploads/messages/demo.mp4' },
    ],
  });

  const createdCall = Message.create.mock.calls[0]?.arguments?.[0]?.[0];
  assert.equal(createdCall.content, '');
  assert.equal(createdCall.attachments.length, 2);
  assert.equal(createdCall.attachments[0].type, 'image');
  assert.equal(createdCall.attachments[1].type, 'video');
});

test('sendMessage phát event realtime sau khi lưu tin nhắn thành công', async (t) => {
  const conversationId = new mongoose.Types.ObjectId();
  const createdMessage = {
    _id: new mongoose.Types.ObjectId(),
    conversation: conversationId,
    sender: new mongoose.Types.ObjectId(),
    recipient: new mongoose.Types.ObjectId(),
    content: 'hello',
    attachments: [],
    createdAt: new Date(),
  };

  const emitted = [];
  const room = {
    emit(eventName, payload) {
      emitted.push({ eventName, payload });
    },
  };

  let redirectTarget = null;
  const req = {
    user: { _id: createdMessage.sender },
    params: { conversationId: conversationId.toString() },
    body: { content: 'hello', attachments: '[]' },
  };
  const res = {
    redirect(statusCode, target) {
      redirectTarget = { statusCode, target };
      return { statusCode, target };
    },
  };

  t.mock.method(conversationService, 'getConversationForParticipant', async () => ({
    _id: conversationId,
    buyer: { _id: createdMessage.sender },
    seller: { _id: createdMessage.recipient },
    listing: { _id: new mongoose.Types.ObjectId(), status: 'active' },
  }));
  t.mock.method(messageService, 'sendMessage', async () => createdMessage);
  t.mock.method(socketModule, 'getSocketServer', () => ({
    to(roomId) {
      assert.equal(roomId.toString(), conversationId.toString());
      return room;
    },
  }));

  await messageController.sendMessage(req, res, () => {
    throw new Error('next should not be called');
  });

  const chatEvent = emitted.find((entry) => entry.eventName === 'chatMessageReceived');
  assert.ok(chatEvent);
  assert.equal(chatEvent.payload.conversationId.toString(), conversationId.toString());
  assert.equal(chatEvent.payload.message.content, 'hello');
  assert.ok(emitted.some((entry) => entry.eventName === 'conversationUpdated'));
  assert.equal(redirectTarget.target, `/messages/${conversationId}#latest`);
});

test('sendMessage không ném 500 khi request multipart không parse body', async (t) => {
  const conversationId = new mongoose.Types.ObjectId();
  const senderId = new mongoose.Types.ObjectId();
  const recipientId = new mongoose.Types.ObjectId();
  const createdMessage = {
    _id: new mongoose.Types.ObjectId(),
    conversation: conversationId,
    sender: senderId,
    recipient: recipientId,
    content: 'hello from multipart',
    attachments: [],
    createdAt: new Date(),
  };

  let redirectTarget = null;
  const req = {
    user: { _id: senderId },
    params: { conversationId: conversationId.toString() },
    body: undefined,
  };
  const res = {
    redirect(statusCode, target) {
      redirectTarget = { statusCode, target };
      return { statusCode, target };
    },
  };

  t.mock.method(conversationService, 'getConversationForParticipant', async () => ({
    _id: conversationId,
    buyer: { _id: senderId },
    seller: { _id: recipientId },
    listing: { _id: new mongoose.Types.ObjectId(), status: 'active' },
  }));
  t.mock.method(messageService, 'sendMessage', async () => createdMessage);
  t.mock.method(socketModule, 'getSocketServer', () => ({
    to() {
      return { emit() {} };
    },
  }));

  await messageController.sendMessage(req, res, () => {
    throw new Error('next should not be called');
  });

  assert.equal(redirectTarget.target, `/messages/${conversationId}#latest`);
});
