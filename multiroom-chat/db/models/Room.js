const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 30 },
    createdAt: { type: Number, default: () => Date.now() }
  },
  { versionKey: false }
);

module.exports = mongoose.model('Room', roomSchema);
