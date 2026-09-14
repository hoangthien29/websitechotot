const mongoose = require('mongoose');

const {
  isManagedCategoryImagePath,
} = require('../utils/categoryImageStorage');

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Tên danh mục là bắt buộc.'],
      trim: true,
      minlength: [2, 'Tên danh mục phải có ít nhất 2 ký tự.'],
      maxlength: [100, 'Tên danh mục không được vượt quá 100 ký tự.'],
      unique: true,
    },
    slug: {
      type: String,
      required: [true, 'Slug danh mục là bắt buộc.'],
      trim: true,
      lowercase: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'Mô tả không được vượt quá 500 ký tự.'],
    },
    image: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator: (value) =>
          value === '' || isManagedCategoryImagePath(value),
        message: 'Ảnh danh mục không hợp lệ.',
      },
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  },
);

module.exports =
  mongoose.models.Category || mongoose.model('Category', categorySchema);
