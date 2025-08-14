const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: "brett12128.aa@gmail.com",
    pass: "atdj khja ucar hrbs"
  }
});

const sendOTP = async (to, otp) => {
  await transporter.sendMail({
    from: "brett12128.aa@gmail.com",
    to,
    subject: 'Your OTP Code',
    text: `Your OTP code is: ${otp}`
  });
};

module.exports={sendOTP}

