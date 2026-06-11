'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');

let transporter = null;

// Initialize transporter if SMTP configuration is provided
function initTransporter() {
  if (transporter) return transporter;

  const { host, port, user, pass, alertEmail } = config.smtp;

  if (!host || !user || !pass || !alertEmail) {
    logger.debug('SMTP email alerts disabled (missing config parameters)');
    return null;
  }

  try {
    transporter = nodemailer.createTransport({
      host,
      port: parseInt(port, 10) || 587,
      secure: parseInt(port, 10) === 465, // true for 465, false for others
      auth: {
        user,
        pass,
      },
    });
    logger.info('SMTP email alerting service initialized successfully');
    return transporter;
  } catch (err) {
    logger.error('Failed to create SMTP mail transporter', { error: err.message });
    return null;
  }
}

/**
 * Send an email alert.
 * @param {string} subject - Alert subject
 * @param {string} text - Plain text body
 * @param {string} html - HTML body (optional)
 */
async function sendAlert(subject, text, html = null) {
  const client = initTransporter();
  if (!client) return;

  const mailOptions = {
    from: `"CosmoShare WA-BOT" <${config.smtp.user}>`,
    to: config.smtp.alertEmail,
    subject: `🚨 [Alert] ${subject}`,
    text,
    html: html || text.replace(/\n/g, '<br>'),
  };

  try {
    const info = await client.sendMail(mailOptions);
    logger.info('Alert email sent successfully', { messageId: info.messageId, subject });
  } catch (err) {
    logger.error('Failed to send alert email', { subject, error: err.message });
  }
}

/**
 * Send alert when QR code is generated.
 * @param {string} spaceUrl - The Hugging Face Space URL
 */
async function sendQrScanAlert(spaceUrl) {
  const subject = 'WhatsApp Bot Scan Required';
  const text = 
    `Your CosmoShare WA-BOT requires a new WhatsApp QR code scan.\n\n` +
    `Please log in to your admin dashboard to view and scan the QR code:\n` +
    `${spaceUrl}\n\n` +
    `If you have set up persistence correctly, this scan should only be needed once.`;
  
  const html = 
    `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #eaeaea; border-radius: 5px;">` +
    `<h2 style="color: #e53e3e;">🚨 WhatsApp Bot Authentication Required</h2>` +
    `<p>Your CosmoShare WA-BOT needs to be linked to your WhatsApp account.</p>` +
    `<p>Please open your Hugging Face Space dashboard to scan the QR code:</p>` +
    `<p style="margin: 20px 0;"><a href="${spaceUrl}" style="background-color: #3182ce; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">Open Admin Dashboard</a></p>` +
    `<p style="font-size: 12px; color: #718096; margin-top: 30px;">This email was sent automatically by your CosmoShare bot instance.</p>` +
    `</div>`;

  await sendAlert(subject, text, html);
}

/**
 * Send alert when bot goes offline.
 * @param {string} reason - Disconnection reason
 */
async function sendOfflineAlert(reason) {
  const subject = 'WhatsApp Bot Offline';
  const text = 
    `Your CosmoShare WA-BOT has disconnected from WhatsApp.\n\n` +
    `Reason: ${reason}\n\n` +
    `The bot will automatically attempt to reconnect. If it fails, a manual restart via the dashboard may be required.`;

  await sendAlert(subject, text);
}

/**
 * Send alert on application crash.
 * @param {string} errorStack - Stack trace
 */
async function sendCrashAlert(errorStack) {
  const subject = 'WhatsApp Bot Critical Crash';
  const text = 
    `Your CosmoShare WA-BOT encountered a fatal error and is shutting down:\n\n` +
    `${errorStack}\n\n` +
    `Hugging Face Spaces will automatically attempt to restart the container, but you may need to check the logs or scan the QR code again.`;

  await sendAlert(subject, text);
}

/**
 * Send email alert when bot is paused.
 * @param {string} pauseType - 'manual' or 'scheduled'
 * @param {string|null} resumeTimeIST - Resume time in IST (if scheduled)
 */
async function sendPauseAlert(pauseType, resumeTimeIST) {
  const subject = 'WhatsApp Bot Paused';
  let text = `Your CosmoShare WA-BOT has been paused.\n\n` +
    `Pause Type: ${pauseType === 'scheduled' ? 'Scheduled' : 'Manual'}\n`;
  
  if (pauseType === 'scheduled' && resumeTimeIST) {
    text += `Scheduled Resume Time: ${resumeTimeIST} (IST)\n\n` +
      `The bot will automatically resume operations at the scheduled time.`;
  } else {
    text += `The bot will remain paused indefinitely until manually resumed via the admin dashboard.`;
  }

  await sendAlert(subject, text);
}

/**
 * Send email alert when bot is resumed.
 * @param {string} resumeType - 'manual' or 'auto'
 */
async function sendResumeAlert(resumeType) {
  const subject = 'WhatsApp Bot Resumed';
  let text = `Your CosmoShare WA-BOT has resumed operations and is now active.\n\n` +
    `Resume Trigger: ${resumeType === 'auto' ? 'Automatic (Scheduled pause period expired)' : 'Manual (Action by administrator)'}\n\n` +
    `The bot is now ready and processing messages.`;

  await sendAlert(subject, text);
}

module.exports = {
  sendAlert,
  sendQrScanAlert,
  sendOfflineAlert,
  sendCrashAlert,
  sendPauseAlert,
  sendResumeAlert,
};
