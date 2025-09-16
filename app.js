const express= require('express');
const connectDB = require('./db/connectDb');
const cors=require('cors');
const cookieParser = require('cookie-parser');
const routes = require('./routes/v1/index.route')
const httpStatus = require("http-status");
const {app,server} = require('./socket/socket');
const { errorHandler,errorConverter } = require("./middlewares/error");
const path= require('path');
const { config } = require('./config');

// const __dirname = path.resolve();

// Require the cloudinary library
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
});



const ApiError= require('./config/apiError');
connectDB();
if (config.isProd) {
  app.set('trust proxy', 1);
}
app.use(express.json({ limit: "50mb" })); // To parse JSON data in the req.body
app.use(express.urlencoded({ extended:false })); //To parse data in req.body
app.use(cookieParser());
const allowedOrigins = (config.isProd
  ? config.cors.prodOrigins
  : config.cors.devOrigins
).concat(config.cors.legacy || []);

app.use(
  cors({
    origin(origin, callback) {
      // allow no-origin (mobile/Postman) if enabled
      if (!origin && config.cors.allowNoOrigin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Not allowed by CORS: ${origin}`), false);
    },
    credentials: true,
  })
);

if (config.uploads?.provider === 'local') {
  const root = path.join(process.cwd(), config.uploads.localDir); 
  app.use(`/${config.uploads.localDir}`, express.static(root, { maxAge: '1d', etag: true }));
}
app.use(
  `/${config.uploads.localDir}`, 
  express.static(path.join(__dirname, config.uploads.localDir))
);

// routes conncection
app.use('/api/v1/', routes)

// giving 404 Error for unknown request
app.use((req, res, next) => {
    next(new ApiError(httpStatus.NOT_FOUND, "404 not found"));
  });
//   handle any error to show error message
  app.use(errorConverter);
  app.use(errorHandler);

  server.listen(config.port, () => {
  console.log(`Server is running on :${config.port} [${config.env}]`);
});