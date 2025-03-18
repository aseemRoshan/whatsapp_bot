const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  date: { type: String, required: true }, // Store as "DD/MM/YYYY"
  batch: { type: String, required: true },
  submitted: [{ type: String }], // Array of student names
});

module.exports = mongoose.model('Submission', submissionSchema);