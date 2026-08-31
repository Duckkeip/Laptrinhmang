const mongoose = require('mongoose');

const directMessageSchema = new mongoose.Schema(
  {
    // Luon luu conversationId = 2 username sap xep theo alphabet, noi voi '::'
    // Vi du: "alice::bob" - dam bao du ai nhan tin truoc, ID cuoc tro chuyen la 1
    conversationId: { type: String, required: true, index: true, trim: true },

    from: { type: String, required: true, trim: true, maxlength: 30 },
    to: { type: String, required: true, trim: true, maxlength: 30 },

    type: { type: String, enum: ['text', 'file'], required: true, default: 'text' },

    // type === 'text'
    text: { type: String, maxlength: 2000 },

    // type === 'file'
    url: String,
    name: String,
    size: Number,
    isImage: Boolean,

    read: { type: Boolean, default: false },
    time: { type: Number, required: true, index: true }
  },
  { versionKey: false }
);

directMessageSchema.index({ conversationId: 1, time: -1 });

module.exports = mongoose.model('DirectMessage', directMessageSchema);
