const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const ApiError = require('../config/apiError');
const catchAsync = require('../config/catchAsync');
require("dotenv").config();
const isAuth = catchAsync(async (req, _, next) => {
  try {
    let token;

    // 1. Check from cookie
    if (req.cookies?.token) {
      token = req.cookies.token;
    }

    // 2. Check from Authorization header
    else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new ApiError(401, "Unauthorized request");
    }

    // 3. Verify token
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const user = await User.findById(decodedToken?._id).select("-password -refreshToken");

    if (!user) {
      throw new ApiError(401, "Invalid Access Token");
    }

    req.user = user;
    next();

  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid access token");
  }
});

module.exports = isAuth;