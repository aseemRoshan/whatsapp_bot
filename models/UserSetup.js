const mongoose = require('mongoose');

const userSetupSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  groupId: { type: String },
  batch: { type: String },
  reportTime: { type: String },
  startTime: { type: String },
  students: [{
    name: { type: String, required: true },
    whatsappId: { type: String, required: true }
  }],
  isBotRunning: { type: Boolean, default: false }
});

module.exports = mongoose.model('UserSetup', userSetupSchema);