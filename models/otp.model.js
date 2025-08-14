const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: String,
  otp: String,
  expiresAt: Date,
  userData: {
    name: String,
    username: String,
    email: String,
    password: String
  }
});

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL

module.exports = mongoose.model('Otp', otpSchema);