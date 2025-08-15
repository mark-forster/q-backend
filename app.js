const express= require('express');
const connectDB = require('./db/connectDb');
require("dotenv").config();
const cors=require('cors');
const cookieParser = require('cookie-parser');
const routes = require('./routes/v1/index.route')
const httpStatus = require("http-status");
const {app,server} = require('./socket/socket');
const { errorHandler,errorConverter } = require("./middlewares/error");
const path= require('path');
const bodyParser=require('body-parser');
// const __dirname = path.resolve();

// Require the cloudinary library
const cloudinary = require('cloudinary').v2;
cloudinary.config({
	cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
	api_key: process.env.CLOUDINARY_API_KEY,
	api_secret: process.env.CLOUDINARY_API_SECRET
});
const ApiError= require('./config/apiError');
connectDB();
app.use(express.json({ limit: "50mb" })); // To parse JSON data in the req.body
app.use(express.json());//To parse json data in req.body
app.use(express.urlencoded({ extended:false })); //To parse data in req.body
app.use(cookieParser());
const allowedOrigins = [        // React local dev
  process.env.RENDER_HOST,
  process.env.DOMAINHOST,  // React production URL
  process.env.LOCALHOST
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Flutter native requests  allow
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(new Error("Not allowed by CORS"), false);
    }
    return callback(null, true);
  },
  credentials: true,
}));

// routes conncection
app.use('/api/v1/', routes)



server.listen(process.env.PORT || 8080,()=>{
    console.log('Server is running on port 8080');
});  

// giving 404 Error for unknown request
app.use((req, res, next) => {
    next(new ApiError(httpStatus.NOT_FOUND, "404 not found"));
  });
//   handle any error to show error message
  app.use(errorConverter);
  app.use(errorHandler);