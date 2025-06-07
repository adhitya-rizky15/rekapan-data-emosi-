const mongoose = require('mongoose');

const emosiSchema = new mongoose.Schema({
  emosi: String,
  gesture: Number,
  waktu: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Emosi', emosiSchema);
