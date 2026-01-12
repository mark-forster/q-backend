const bcrypt = require("bcrypt");
const Otp = require("../models/otp.model");

const generateAndSaveOTP = async (email, options) => {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = await bcrypt.hash(otp, 10);

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

 await Otp.findOneAndUpdate(
  { email, purpose: options.purpose },
  {
    email,
    otpHash,
    purpose: options.purpose,
    ...(options.payload && { payload: options.payload }),
    attempts: 0,
    expiresAt,
  },
  { upsert: true }
);


  return otp;
};

const verifyOTP = async (email, otp, purpose) => {
  const record = await Otp.findOne({ email, purpose });
  if (!record) return null;

  if (record.expiresAt < new Date()) return null;
  if (record.attempts >= 3) return null;

  const isValid = await bcrypt.compare(otp, record.otpHash);
  if (!isValid) {
    record.attempts += 1;
    await record.save();
    return null;
  }

  return record.payload;
};

const clearOTP = async (email, purpose) => {
  await Otp.deleteOne({ email, purpose });
};

module.exports = { generateAndSaveOTP, verifyOTP, clearOTP };
