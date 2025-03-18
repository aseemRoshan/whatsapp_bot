const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  batch: { type: String, required: true },
  whatsappId: { type: String, required: true, unique: true } // Add this
});

module.exports = mongoose.model('Student', studentSchema);