const nodemailer = require('nodemailer');
const config = require('../config');

let transporter;

function emailTransport() {
  if (!config.emailConfigPresent) throw new Error('SMTP delivery is not configured');
  if (!transporter) {
    transporter = nodemailer.createTransport(config.smtpUrl, {
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }
  return transporter;
}

async function sendEmail(to, subject, text) {
  await emailTransport().sendMail({ from: config.smtpFrom, to, subject, text });
}

async function sendSms(to, text) {
  if (!config.smsConfigPresent) throw new Error('Twilio delivery is not configured');
  if (!/^\+[1-9]\d{7,14}$/.test(to)) throw new Error('Recipient phone number must be in E.164 format');
  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
  const body = new URLSearchParams({ From: config.twilioFromNumber, To: to, Body: text.slice(0, 1500) });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilioAccountSid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Twilio rejected the message (HTTP ${response.status})`);
}

async function sendPasswordReset(email, code) {
  await sendEmail(
    email,
    'MediKit password reset code',
    `Your MediKit password reset code is ${code}. It expires in 15 minutes. If you did not request this, you can ignore this email.`,
  );
}

module.exports = { sendEmail, sendSms, sendPasswordReset };
