const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Tiêu đề bài đăng là bắt buộc.'],
      trim: true,
      minlength: [5, 'Tiêu đề phải có ít nhất 5 ký tự.'],
      maxlength: [150, 'Tiêu đề không được vượt quá 150 ký tự.'],
    },
    description: {
      type: String,
      required: [true, 'Mô tả bài đăng là bắt buộc.'],
      trim: true,
      minlength: [20, 'Mô tả phải có ít nhất 20 ký tự.'],
      maxlength: [3000, 'Mô tả không được vượt quá 3000 ký tự.'],
    },
    price: {
      type: Number,
      required: [true, 'Giá sản phẩm là bắt buộc.'],
      min: [0, 'Giá sản phẩm không được nhỏ hơn 0.'],
      max: [100000000000, 'Giá sản phẩm vượt quá giới hạn cho phép.'],
      validate: {
        validator: Number.isFinite,
        message: 'Giá sản phẩm phải là một số hữu hạn.',
      },
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Danh mục là bắt buộc.'],
      index: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Người bán là bắt buộc.'],
      index: true,
    },
    location: {
      type: String,
      required: [true, 'Địa điểm là bắt buộc.'],
      trim: true,
      minlength: [2, 'Địa điểm phải có ít nhất 2 ký tự.'],
      maxlength: [150, 'Địa điểm không được vượt quá 150 ký tự.'],
    },
    condition: {
      type: String,
      enum: ['new', 'used'],
      default: 'used',
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (images) =>
          Array.isArray(images) && images.length <= 5,
        message: 'Một bài đăng chỉ được có tối đa 5 ảnh.',
      },
    },
    status: {
      type: String,
      enum: ['active', 'sold', 'hidden'],
      default: 'active',
      index: true,
    },
    moderation: {
      isHiddenByAdmin: {
        type: Boolean,
        default: false,
      },
      reason: {
        type: String,
        trim: true,
        maxlength: 500,
        default: '',
      },
      moderatedAt: {
        type: Date,
        default: null,
      },
      moderatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      previousStatus: {
        type: String,
        enum: ['active', 'sold', null],
        default: null,
      },
    },
  },
  {
    timestamps: true,
  },
);

listingSchema.index({ createdAt: -1 });
listingSchema.index({ category: 1, status: 1, createdAt: -1 });
listingSchema.index({ seller: 1, createdAt: -1 });
listingSchema.index({ status: 1, createdAt: -1 });
listingSchema.index({ status: 1, condition: 1, price: 1 });
listingSchema.index({
  status: 1,
  'moderation.isHiddenByAdmin': 1,
  createdAt: -1,
});

module.exports =
  mongoose.models.Listing || mongoose.model('Listing', listingSchema);
