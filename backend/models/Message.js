const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: [true, 'Cuộc trò chuyện là bắt buộc.'],
      immutable: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Người gửi là bắt buộc.'],
      immutable: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Người nhận là bắt buộc.'],
      immutable: true,
    },
    content: {
      type: String,
      required: [true, 'Nội dung tin nhắn là bắt buộc.'],
      trim: true,
      minlength: [1, 'Nội dung tin nhắn là bắt buộc.'],
      maxlength: [2000, 'Tin nhắn không được vượt quá 2.000 ký tự.'],
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

messageSchema.index({
  conversation: 1,
  createdAt: -1,
  _id: -1,
});
messageSchema.index({
  recipient: 1,
  readAt: 1,
  createdAt: -1,
});
messageSchema.index({
  conversation: 1,
  recipient: 1,
  readAt: 1,
});

module.exports =
  mongoose.models.Message || mongoose.model('Message', messageSchema);
