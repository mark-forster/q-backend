const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: "brett12128.aa@gmail.com",
    pass: "atdj khja ucar hrbs"
  }
});

const sendOTP = async (to, otp) => {
  const expiryTime = "60 seconds"; 
  const logoUrl = "https://logos-world.net/wp-content/uploads/2021/02/Facebook-Messenger-Logo.png";
  const mailOptions = {
    from: '"Arakkha Chat" chat.arakkha.tech',
    to,
    subject: 'Action Required: OTP Verification Code',
    html: `
    <div style="background-color: #121212; padding: 40px 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <div style="max-width: 500px; margin: 0 auto; background-color: #1e1e1e; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        
        <div style="background-color: #2c2c2c; padding: 30px; text-align: center; border-bottom: 1px solid #333;">
          <img src="${logoUrl}" alt="Company Logo" style="width: 60px; height: auto; margin-bottom: 10px;">
          <h2 style="color: #ffffff; margin: 0; font-size: 22px; letter-spacing: 1px;">Secure Access</h2>
        </div>

        <div style="padding: 40px 30px; text-align: center;">
          <p style="color: #aaaaaa; font-size: 16px; margin-bottom: 25px;">Please use the following code to verify your identity.</p>
          
          <div style="background: #282828; padding: 20px; border-radius: 12px; display: inline-block; border: 1px solid #3d3d3d; margin-bottom: 25px;">
            <span style="font-size: 32px; font-weight: 800; color: #4CAF50; letter-spacing: 5px;">${otp}</span>
          </div>

          <p style="color: #888888; font-size: 14px; margin-bottom: 30px;">
            This code will expire in <strong style="color: #f44336;">${expiryTime}</strong>.
          </p>
        </div>

        <div style="background-color: #1a1a1a; padding: 20px; text-align: center; border-top: 1px solid #333;">
          <p style="color: #555555; font-size: 12px; margin: 0;">
            If you did not request this code, please ignore this email.
          </p>
          <p style="color: #555555; font-size: 12px; margin-top: 5px;">
            &copy; 2025 Your Business Name. All rights reserved.
          </p>
        </div>
      </div>
    </div>
    `
  };

  await transporter.sendMail(mailOptions);
};

module.exports = { sendOTP };