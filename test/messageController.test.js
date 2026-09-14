const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');

const messageController = require('../src/controllers/message.controller');
const conversationService = require('../src/services/conversation.service');
const messageService = require('../src/services/message.service');

const createResponse = () => ({
  locals: { unreadMessageCount: 5 },
  statusCode: 200,
  redirectStatus: null,
  redirectUrl: '',
  view: '',
  data: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  redirect(status, url) {
    this.redirectStatus = status;
    this.redirectUrl = url;
    return this;
  },
  render(view, data) {
    this.view = view;
    this.data = data;
    return this;
  },
});

const createConversation = (buyerId, sellerId) => ({
  _id: new mongoose.Types.ObjectId(),
  listing: {
    _id: new mongoose.Types.ObjectId(),
    title: 'Xe máy kiểm thử',
    status: 'active',
    images: [],
    price: 1000000,
  },
  buyer: { _id: buyerId, name: 'Người mua', avatar: '' },
  seller: { _id: sellerId, name: 'Người bán', avatar: '' },
  lastMessagePreview: '',
  lastMessageAt: null,
  createdAt: new Date(),
});

test('startConversation luôn dùng req.user và redirect 303 tới Conversation', async (t) => {
  const buyerId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId().toString();
  const conversationId = new mongoose.Types.ObjectId();
  let received;

  t.mock.method(
    conversationService,
    'findOrCreateConversation',
    async (receivedListingId, receivedUserId) => {
      received = [receivedListingId, receivedUserId];
      return { _id: conversationId };
    },
  );
  const req = {
    user: { _id: buyerId },
    params: { id: listingId },
    query: {},
    body: {
      buyer: new mongoose.Types.ObjectId().toString(),
      seller: new mongoose.Types.ObjectId().toString(),
    },
    originalUrl: `/listings/${listingId}/conversations`,
  };
  const res = createResponse();

  await messageController.startConversation(req, res, assert.fail);

  assert.deepEqual(received, [listingId, buyerId]);
  assert.equal(res.redirectStatus, 303);
  assert.equal(res.redirectUrl, `/messages/${conversationId}#latest`);
});

test('showConversation khóa participant, mark read và cập nhật badge cùng response', async (t) => {
  const buyerId = new mongoose.Types.ObjectId();
  const sellerId = new mongoose.Types.ObjectId();
  const conversation = createConversation(buyerId, sellerId);
  let participantArgs;

  t.mock.method(
    conversationService,
    'getConversationForParticipant',
    async (...args) => {
      participantArgs = args;
      return conversation;
    },
  );
  t.mock.method(
    messageService,
    'markConversationAsRead',
    async () => ({ markedCount: 3 }),
  );
  t.mock.method(messageService, 'getMessagesPage', async () => ({
    items: [],
    pagination: {
      page: 1,
      limit: 50,
      totalItems: 0,
      totalPages: 1,
      hasPrev: false,
      hasNext: false,
      previousPage: null,
      nextPage: null,
      hasOlderPage: false,
      olderPage: null,
    },
  }));
  const req = {
    user: { _id: sellerId },
    params: { conversationId: conversation._id.toString() },
    query: {},
    body: {},
    originalUrl: `/messages/${conversation._id}`,
  };
  const res = createResponse();

  await messageController.showConversation(req, res, assert.fail);

  assert.deepEqual(participantArgs, [
    conversation._id.toString(),
    sellerId,
  ]);
  assert.equal(res.locals.unreadMessageCount, 2);
  assert.equal(res.view, 'messages/show');
  assert.equal(res.data.canSend, true);
});

test('sendMessage bỏ qua sender/recipient giả và chỉ truyền current User', async (t) => {
  const buyerId = new mongoose.Types.ObjectId();
  const sellerId = new mongoose.Types.ObjectId();
  const conversation = createConversation(buyerId, sellerId);
  let sendInput;

  t.mock.method(
    conversationService,
    'getConversationForParticipant',
    async () => conversation,
  );
  t.mock.method(messageService, 'sendMessage', async (input) => {
    sendInput = input;
  });
  const req = {
    user: { _id: buyerId },
    params: { conversationId: conversation._id.toString() },
    query: {},
    body: {
      content: 'Tin hợp lệ',
      sender: sellerId.toString(),
      recipient: buyerId.toString(),
      role: 'admin',
    },
    originalUrl: `/messages/${conversation._id}`,
  };
  const res = createResponse();

  await messageController.sendMessage(req, res, assert.fail);

  assert.equal(sendInput.conversation, conversation);
  assert.equal(sendInput.senderId, buyerId);
  assert.equal(sendInput.content, 'Tin hợp lệ');
  assert.equal(Object.hasOwn(sendInput, 'recipient'), false);
  assert.equal(res.redirectStatus, 303);
  assert.equal(res.redirectUrl, `/messages/${conversation._id}#latest`);
});

test('User không phải participant nhận 404 và không tải Message', async (t) => {
  t.mock.method(
    conversationService,
    'getConversationForParticipant',
    async () => null,
  );
  const messagePageMock = t.mock.method(
    messageService,
    'getMessagesPage',
    async () => {
      assert.fail('Không được tải Message khi không phải participant');
    },
  );
  const req = {
    user: { _id: new mongoose.Types.ObjectId() },
    params: { conversationId: new mongoose.Types.ObjectId().toString() },
    query: {},
    body: {},
    originalUrl: '/messages/private',
  };
  const res = createResponse();

  await messageController.showConversation(req, res, assert.fail);

  assert.equal(res.statusCode, 404);
  assert.equal(res.view, 'errors/404');
  assert.equal(messagePageMock.mock.callCount(), 0);
});
