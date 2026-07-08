const mongoose = require('mongoose');

const ScheduledMessageSchema = new mongoose.Schema({
  message: {
    type: String,
    required: true,
  },
  scheduledAt: {
    type: Date,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending',
  },
  error: {
    type: String,
    default: null,
  }
}, { timestamps: true });

const MessageSchema = new mongoose.Schema({
  message: {
    type: String,
    required: true,
  },
  insertedAt: {
    type: Date,
    default: Date.now,
  }
}, { timestamps: true });

const ScheduledMessage = mongoose.model('ScheduledMessage', ScheduledMessageSchema);
const Message = mongoose.model('Message', MessageSchema);

module.exports = {
  ScheduledMessage,
  Message
};
