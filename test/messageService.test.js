const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');

const Conversation = require('../src/models/Conversation');
const Listing = require('../src/models/Listing');
const Message = require('../src/models/Message');
const messageService = require('../src/services/message.service');

const createMessageQuery = (value) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  sort() {
    return this;
  },
  skip() {
    return this;
  },
  limit() {
    return this;
  },
  session() {
    return this;
  },
  lean() {
    return Promise.resolve(value);
  },
});

test('normalizeMessageContent chỉ nhận chuỗi trim từ 1 đến 2.000 ký tự', () => {
  assert.equal(messageService.normalizeMessageContent('  Xin chào  '), 'Xin chào');

  for (const content of ['', '   ', null, [], { $ne: null }]) {
    assert.throws(
      () => messageService.normalizeMessageContent(content),
      (error) => error.code === messageService.MESSAGE_CONTENT_INVALID,
    );
  }

  assert.throws(
    () => messageService.normalizeMessageContent('a'.repeat(2001)),
    (error) =>
      error.code === messageService.MESSAGE_CONTENT_INVALID &&
      error.message === messageService.MESSAGE_CONTENT_TOO_LONG_MESSAGE,
  );
});

test('getMessagesPage lấy mới nhất trong MongoDB rồi đảo thành cũ tới mới', async (t) => {
  const conversationId = new mongoose.Types.ObjectId();
  const olderId = new mongoose.Types.ObjectId();
  const newerId = new mongoose.Types.ObjectId();

  t.mock.method(Message, 'find', () =>
    createMessageQuery([
      { _id: newerId, content: 'Mới' },
      { _id: olderId, content: 'Cũ' },
    ]),
  );
  t.mock.method(Message, 'countDocuments', async () => 51);

  const result = await messageService.getMessagesPage(
    conversationId,
    1,
    50,
  );

  assert.deepEqual(
    result.items.map((message) => message.content),
    ['Cũ', 'Mới'],
  );
  assert.equal(result.pagination.totalPages, 2);
  assert.equal(result.pagination.hasOlderPage, true);
  assert.equal(result.pagination.olderPage, 2);
});

test('sendMessage dùng transaction, tự xác định recipient và cập nhật metadata', async (t) => {
  const conversationId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId();
  const buyerId = new mongoose.Types.ObjectId();
  const sellerId = new mongoose.Types.ObjectId();
  const createdAt = new Date();
  let createdData;
  let metadataUpdate;
  let ended = false;
  const session = {
    async withTransaction(work) {
      await work();
    },
    async endSession() {
      ended = true;
    },
  };

  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Listing, 'findById', () =>
    createMessageQuery({ _id: listingId, status: 'sold' }),
  );
  t.mock.method(Message, 'create', async (rows) => {
    [createdData] = rows;
    return [{ ...createdData, _id: new mongoose.Types.ObjectId(), createdAt }];
  });
  t.mock.method(Conversation, 'updateOne', async (filter, update) => {
    metadataUpdate = { filter, update };
    return { matchedCount: 1 };
  });

  await messageService.sendMessage({
    conversation: {
      _id: conversationId,
      listing: { _id: listingId },
      buyer: { _id: buyerId },
      seller: { _id: sellerId },
    },
    senderId: buyerId,
    content: `  ${'<script>alert(1)</script>'.repeat(10)}  `,
  });

  assert.equal(createdData.sender, buyerId);
  assert.equal(createdData.recipient, sellerId);
  assert.equal(createdData.readAt, null);
  assert.equal(createdData.content.startsWith('<script>'), true);
  assert.equal(metadataUpdate.filter._id, conversationId);
  assert.equal(metadataUpdate.update.$set.lastSender, buyerId);
  assert.equal(metadataUpdate.update.$set.lastMessageAt, createdAt);
  assert.equal(metadataUpdate.update.$set.lastMessagePreview.length, 200);
  assert.equal(ended, true);
});

test('sendMessage rollback-safe khi metadata lỗi và chặn Listing hidden', async (t) => {
  const conversationId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId();
  const buyerId = new mongoose.Types.ObjectId();
  const sellerId = new mongoose.Types.ObjectId();
  let status = 'active';
  let transactionFailed = false;
  const session = {
    async withTransaction(work) {
      try {
        await work();
      } catch (error) {
        transactionFailed = true;
        throw error;
      }
    },
    async endSession() {},
  };

  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Listing, 'findById', () =>
    createMessageQuery({ _id: listingId, status }),
  );
  const createMock = t.mock.method(Message, 'create', async (rows) => [
    {
      ...rows[0],
      _id: new mongoose.Types.ObjectId(),
      createdAt: new Date(),
    },
  ]);
  t.mock.method(Conversation, 'updateOne', async () => ({ matchedCount: 0 }));

  const input = {
    conversation: {
      _id: conversationId,
      listing: listingId,
      buyer: buyerId,
      seller: sellerId,
    },
    senderId: buyerId,
    content: 'Tin kiểm thử',
  };

  await assert.rejects(
    messageService.sendMessage(input),
    (error) => error.code === messageService.MESSAGE_METADATA_UPDATE_FAILED,
  );
  assert.equal(transactionFailed, true);

  status = 'hidden';
  await assert.rejects(
    messageService.sendMessage(input),
    (error) => error.code === messageService.MESSAGE_LISTING_HIDDEN,
  );
  assert.equal(createMock.mock.callCount(), 1);
});

test('mark read chỉ cập nhật recipient trong Conversation hiện tại và countUnread khóa theo User', async (t) => {
  const conversationId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  let markFilter;
  let countFilter;

  t.mock.method(Message, 'updateMany', async (filter) => {
    markFilter = filter;
    return { modifiedCount: 4 };
  });
  t.mock.method(Message, 'countDocuments', async (filter) => {
    countFilter = filter;
    return 7;
  });

  assert.deepEqual(
    await messageService.markConversationAsRead(conversationId, userId),
    { markedCount: 4 },
  );
  assert.equal(markFilter.conversation, conversationId);
  assert.equal(markFilter.recipient, userId);
  assert.equal(markFilter.readAt, null);
  assert.equal(await messageService.countUnreadMessages(userId), 7);
  assert.deepEqual(countFilter, { recipient: userId, readAt: null });
});
