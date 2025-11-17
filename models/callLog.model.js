const mongoose = require("mongoose");

const callLogSchema = new mongoose.Schema(
  {
    roomID: { type: String, required: true, index: true },
    caller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    callType: { type: String, enum: ["audio", "video"], default: "audio" },

    status: {
      type: String,
      enum: ["ringing", "missed", "rejected", "completed", "cancelled"],
      default: "ringing",
    },

    startedAt: { type: Date },
    endedAt: { type: Date },
    durationSeconds: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const CallLog = mongoose.model("CallLog", callLogSchema);

module.exports = CallLog;
