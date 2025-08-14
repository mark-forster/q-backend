const mongoose = require('mongoose');
require('dotenv').config();
const path=require('path')
const connectDB= async()=>{
    try{
        const connectionInstance= await mongoose.connect(process.env.DB_URL)
        console.log(`DB connection: ${process.env.DB_URL}`)
    }
    catch(err){
        console.error(err);
    }
}
module.exports = connectDB;