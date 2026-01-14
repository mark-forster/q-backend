const { generateToken04 } = require("../util/zegoServerAssistant");
const httpStatus = require("http-status");

const ZEGO_APP_ID = Number(process.env.ZEGO_APP_ID);
const ZEGO_SECRET = process.env.ZEGO_SERVER_SECRET;

// helper – stringify error format
const errorResponse = (res, status, message) =>
  res.status(status).json({ error: message });

const getZegoToken = async (req, res, next) => {
  try {
    const { roomID, userID } = req.body;

    //validation
    if (!roomID || !userID) {
      return errorResponse(
        res,
        httpStatus.BAD_REQUEST,
        "roomID and userID are required."
      );
    }

    if (typeof roomID !== "string" || typeof userID !== "string") {
      return errorResponse(
        res,
        httpStatus.BAD_REQUEST,
        "roomID and userID must be strings."
      );
    }

    //sanitization
    if (roomID.length > 128 || userID.length > 64) {
      return errorResponse(
        res,
        httpStatus.BAD_REQUEST,
        "roomID or userID too long."
      );
    }
    const authUserId = String(req.user?.id || req.user?._id || "");
    if (authUserId && authUserId !== String(userID)) {
      return errorResponse(
        res,
        httpStatus.FORBIDDEN,
        "You can only request token for your own user."
      );
    }

    if (!ZEGO_APP_ID || !ZEGO_SECRET || ZEGO_SECRET.length !== 32) {
      return errorResponse(
        res,
        httpStatus.INTERNAL_SERVER_ERROR,
        "Zego credential not configured properly."
      );
    }

    const effectiveTimeInSeconds = 3600;

    const payload = JSON.stringify({ roomID });

    const token = generateToken04(
      ZEGO_APP_ID,
      userID,
      ZEGO_SECRET,
      effectiveTimeInSeconds,
      payload
    );

    return res.status(httpStatus.OK).json({
      token,
      roomID,
      userID,
      expireIn: effectiveTimeInSeconds,
    });
  } catch (error) {
    console.error("Zego Token Generation Error:", error);
    return errorResponse(
      res,
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to generate Zego Token."
    );
  }
};

module.exports = { getZegoToken };
