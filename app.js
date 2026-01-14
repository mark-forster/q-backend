require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const httpStatus = require("http-status");

const connectDB = require("./db/connectDb");
const routes = require("./routes/v1/index.route");
const { errorHandler, errorConverter } = require("./middlewares/error");
const ApiError = require("./config/apiError");
const { config } = require("./config");

//  CREATE EXPRESS APP HERE
const app = express();
const server = http.createServer(app);

//  INIT SOCKET 
const initSocket = require("./socket");
initSocket(server);

// Cloudinary
const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
});

// DB
connectDB();

// Trust proxy
if (config.isProd) {
  app.set("trust proxy", 1);
}

// Middlewares
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// CORS
const allowedOrigins = (config.isProd
  ? config.cors.prodOrigins
  : config.cors.devOrigins
).concat(config.cors.legacy || []);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin && config.cors.allowNoOrigin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Not allowed by CORS: ${origin}`), false);
    },
    credentials: true,
  })
);

// Static uploads
if (config.uploads?.provider === "local") {
  const root = path.join(process.cwd(), config.uploads.localDir);
  app.use(`/${config.uploads.localDir}`, express.static(root));
}

// Routes
app.use("/api/v1", routes);

// 404
app.use((req, res, next) => {
  next(new ApiError(httpStatus.NOT_FOUND, "404 not found"));
});

// Error handlers
app.use(errorConverter);
app.use(errorHandler);

// Start server
server.listen(config.port, () => {
  console.log(`Server running on ${config.port} [${config.env}]`);
});
