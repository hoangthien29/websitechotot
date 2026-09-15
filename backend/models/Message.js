const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['image', 'video'],
      required: [true, 'Loại file đính kèm là bắt buộc.'],
    },
    url: {
      type: String,
      required: [true, 'Đường dẫn file đính kèm là bắt buộc.'],
      trim: true,
    },
    thumbnail: {
      type: String,
      trim: true,
      default: '',
    },
    mimeType: {
      type: String,
      trim: true,
      default: '',
    },
    size: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false },
);

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
      trim: true,
      maxlength: [5000],
      default: '',
    },
    attachments: [attachmentSchema],
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
