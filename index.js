const { Client } = require('whatsapp-web.js');
const connectDB = require('./db');
const Student = require('./models/Student');
const Submission = require('./models/Submission');
const cron = require('node-cron');
const qrcode = require('qrcode');

// Connect to MongoDB
connectDB();

// Initialize WhatsApp Client
const client = new Client();

client.on('qr', (qr) => {
  qrcode.toString(qr, { type: 'terminal' }, (err, url) => {
    if (err) console.error('Error generating QR code:', err);
    else console.log(url);
  });
  console.log('Scan the QR code above with your WhatsApp');
});

client.on('ready', () => {
  console.log('WhatsApp Bot is ready!');
  console.log('Authenticated user ID:', client.info.wid._serialized);
  client.getChats().then(chats => {
    const group = chats.find(chat => chat.id._serialized === '120363416908226125@g.us');
    console.log('Bot is in group:', group ? group.name : 'Not found');
  });
});

// Use message_create to capture all messages, including from authenticated user
client.on('message_create', async (msg) => {
  const groupId = '120363416908226125@g.us';
  console.log(`[DEBUG] Message created - Type: ${msg.type}, From: ${msg.from}, To: ${msg.to}, Author: ${msg.author || 'undefined'}`);

  // Only process audio messages from the group
  if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio') && (msg.from === groupId || msg.to === groupId)) {
    const botUserId = client.info.wid._serialized; // '919778137771@c.us'

    let whatsappId;
    if (msg.author) {
      whatsappId = msg.author; // Non-authenticated users
    } else {
      whatsappId = botUserId; // Authenticated user (no author in group)
    }

    const today = new Date().toLocaleDateString('en-GB');

    console.log(`Bot user ID: ${botUserId}`);
    console.log(`Processing audio - msg.author: ${msg.author}, msg.from: ${msg.from}, msg.to: ${msg.to}`);
    console.log(`Assigned whatsappId: ${whatsappId}`);

    try {
      const student = await Student.findOne({ whatsappId });
      console.log(`Student lookup for ${whatsappId}:`, student ? student : 'Not found');

      if (student) {
        await updateSubmission(whatsappId, today);
        console.log(`${student.name} (${whatsappId}) submitted an audio on ${today}`);
      } else {
        console.log(`No student found for ${whatsappId} - not in database`);
      }
    } catch (error) {
      console.error(`Error processing submission for ${whatsappId}:`, error);
    }
  } else {
    console.log('[DEBUG] Message ignored - not an audio or not from/to group');
  }
});

client.initialize();

// Function to update submission in MongoDB
async function updateSubmission(whatsappId, date) {
  let submission = await Submission.findOne({ date, batch: 'BCK221 A' });
  if (!submission) {
    submission = new Submission({ date, batch: 'BCK221 A', submitted: [] });
  }
  if (!submission.submitted.includes(whatsappId)) {
    submission.submitted.push(whatsappId);
    await submission.save();
    console.log('Submission saved:', submission);
  } else {
    console.log(`Submission already recorded for ${whatsappId} on ${date}`);
  }
}

// Generate Daily Report
async function generateReport() {
  const today = new Date().toLocaleDateString('en-GB');
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const students = await Student.find({ batch: 'BCK221 A' });
  const submission = await Submission.findOne({ date: today, batch: 'BCK221 A' }) || { submitted: [] };

  const submitted = students.filter((s) => submission.submitted.includes(s.whatsappId));
  const notSubmitted = students.filter((s) => !submission.submitted.includes(s.whatsappId));

  const report = `
Daily Task Report
------------------------------
Batch: BCK221 A
Day: ${dayName}
Date: ${today}
------------------------------
Submitted:
${submitted.map((s) => `✅ ${s.name}`).join('\n')}
Not Submitted:
${notSubmitted.map((s) => `❌ ${s.name}`).join('\n')}
Consistency leads to success. Great job to those who submitted, keep the momentum going! 🎯
  `.trim();

  const groupId = process.env.GROUP_ID || '120363416908226125@g.us';
  await client.sendMessage(groupId, report);
  console.log('Report sent:', report);
}

// Schedule report with error handling
try {
  cron.schedule('50 17 * * *', () => {
    generateReport();
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });
  console.log('Cron job scheduled for 17:50 AM');
} catch (error) {
  console.error('Error scheduling cron job:', error);
}