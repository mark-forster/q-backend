const {
  MailerSend,
  EmailParams,
  Sender,
  Recipient,
} = require("mailersend");

const { config } = require("../config");

const mailerSend = new MailerSend({
  apiKey: config.mail.apiKey,
});

const sendOTP = async (to, otp) => {
  const expiryTime = "60 seconds";
  const logoUrl =
    "https://logos-world.net/wp-content/uploads/2021/02/Facebook-Messenger-Logo.png";

  const from = new Sender(
    config.mail.fromEmail, // noreply@chat.arakkha.tech
    config.mail.fromName   // Arakkha Chat
  );

  const recipients = [new Recipient(to)];

  const html = `
    <div style="background-color:#121212;padding:40px 0;font-family:Segoe UI">
      <div style="max-width:500px;margin:auto;background:#1e1e1e;border-radius:16px">
        <div style="padding:30px;text-align:center">
          <img src="${logoUrl}" width="60" />
          <h2 style="color:#fff">Secure Access</h2>
        </div>

        <div style="padding:30px;text-align:center">
          <p style="color:#aaa">Your OTP code</p>
          <div style="font-size:32px;font-weight:800;color:#4CAF50">
            ${otp}
          </div>
          <p style="color:#f44336">Expires in ${expiryTime}</p>
        </div>

        <div style="padding:20px;text-align:center;color:#555">
          If you didn’t request this, ignore this email.
        </div>
      </div>
    </div>
  `;

  const params = new EmailParams()
    .setFrom(from)
    .setTo(recipients)
    .setSubject("Action Required: OTP Verification Code")
    .setHtml(html)
    .setText(`Your OTP is ${otp}. It expires in ${expiryTime}.`);

  await mailerSend.email.send(params);
};

module.exports = { sendOTP };
