const { Client } = require('whatsapp-web.js');
const express = require('express');
const connectDB = require('./db');
const Student = require('./models/Student');
const Submission = require('./models/Submission');
const cron = require('node-cron');
const http = require('http');
const qrcode = require('qrcode');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// Initialize WhatsApp Client
const client = new Client();
let qrCodeData = null;
let isAuthenticated = false;
let groupId = null;
let reportCron = null;
let submissionStartTime = '09:00';
let reportTime = '19:40';
let batch = 'BCK221 A'; // Default batch, will be overridden by user input
let isBotRunning = false;

client.on('qr', (qr) => {
  qrcode.toDataURL(qr, (err, url) => {
    if (err) console.error('Error generating QR code:', err);
    else {
      qrCodeData = url;
      console.log('QR code generated');
      io.emit('qr', { qr: qrCodeData });
      console.log('Emitted QR event to frontend');
    }
  });
});

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('hello', (res) => {
    console.log('Hello response:', res);
  });
});

client.on('ready', async () => {
  console.log('WhatsApp Bot is ready!');
  console.log('Authenticated user ID:', client.info.wid._serialized);
  isAuthenticated = true;

  let groups = [];
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const chats = await client.getChats();
    console.log(`Attempt ${i + 1} - Raw chats:`, chats.map(chat => ({ name: chat.name, id: chat.id._serialized, isGroup: chat.isGroup })));
    groups = chats.filter(chat => chat.id._serialized.endsWith('@g.us')).map(group => ({
      name: group.name || 'Unnamed Group',
      id: group.id._serialized
    }));
    console.log(`Attempt ${i + 1} - Groups fetched:`, groups);
    if (groups.length > 0) break;
  }

  const contacts = await client.getContacts();
  const contactList = contacts
    .filter(contact => contact.isMyContact && contact.number && contact.id._serialized.endsWith('@c.us')) // Filter for @c.us only
    .map(contact => {
      console.log(`[DEBUG] Contact: ${contact.name || contact.pushname || 'Unknown'} - ID: ${contact.id._serialized}`);
      return {
        name: contact.name || contact.pushname || contact.number,
        id: contact.id._serialized
      };
    });
  console.log('Contacts fetched:', contactList.length);
  if (contacts.some(contact => contact.id._serialized.endsWith('@lid'))) {
    console.log('[WARNING] Some contacts have @lid IDs and were excluded:', 
      contacts.filter(c => c.id._serialized.endsWith('@lid')).map(c => c.id._serialized));
  }

  io.emit('authenticated', {
    message: 'User authenticated successfully',
    groups,
    contacts: contactList
  });
  console.log('Emitted authenticated event to frontend');
});

client.on('message_create', async (msg) => {
  if (!groupId || !isBotRunning) return;
  console.log(`[DEBUG] Message created - Type: ${msg.type}, From: ${msg.from}, To: ${msg.to}, Author: ${msg.author || 'undefined'}`);

  if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio') && (msg.from === groupId || msg.to === groupId)) {
    const botUserId = client.info.wid._serialized;
    let whatsappId = msg.author || botUserId;

    const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const currentDateTime = new Date(now);
    const hours = currentDateTime.getHours();
    const minutes = currentDateTime.getMinutes();
    const timeInMinutes = hours * 60 + minutes;

    const [startHours, startMinutes] = submissionStartTime.split(':').map(Number);
    const [endHours, endMinutes] = reportTime.split(':').map(Number);
    const startTime = startHours * 60 + startMinutes;
    const endTime = endHours * 60 + endMinutes;

    if (timeInMinutes < startTime || timeInMinutes > endTime) {
      console.log(`Audio submission from ${whatsappId} ignored - Outside valid window (${submissionStartTime} - ${reportTime} IST)`);
      return;
    }

    const submissionDate = currentDateTime.toLocaleDateString('en-GB');

    console.log(`Processing audio - Assigned whatsappId: ${whatsappId}, Submission Date: ${submissionDate}`);
    try {
      const student = await Student.findOne({ whatsappId });
      if (student) {
        await updateSubmission(whatsappId, submissionDate);
        console.log(`${student.name} (${whatsappId}) submitted an audio counted for ${submissionDate}`);
      }
    } catch (error) {
      console.error(`Error processing submission for ${whatsappId}:`, error);
    }
  }
});

client.initialize();

// API Endpoints
app.get('/qr', (req, res) => {
  if (qrCodeData) {
    res.json({ qr: qrCodeData });
  } else if (isAuthenticated) {
    res.json({ authenticated: true });
  } else {
    res.status(503).json({ error: 'QR code not yet generated' });
  }
});

app.post('/setup', async (req, res) => {
  if (!isAuthenticated) return res.status(401).json({ error: 'Not authenticated' });
  const { groupId: newGroupId, batch: newBatch, reportTime: newReportTime, startTime, students } = req.body;
  if (!newGroupId || !newBatch || !newReportTime || !startTime || !students || !Array.isArray(students)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  for (const student of students) {
    if (!student.whatsappId.match(/^\d+@c\.us$/)) {
      return res.status(400).json({ error: `Invalid WhatsApp ID format for ${student.name}: ${student.whatsappId}` });
    }
  }

  const [startHours, startMinutes] = startTime.split(':').map(Number);
  const [reportHours, reportMinutes] = newReportTime.split(':').map(Number);
  const startInMinutes = startHours * 60 + startMinutes;
  const reportInMinutes = reportHours * 60 + reportMinutes;
  if (startInMinutes >= reportInMinutes) {
    return res.status(400).json({ error: 'Start time must be before report time' });
  }

  groupId = newGroupId;
  batch = newBatch;
  submissionStartTime = startTime;
  reportTime = newReportTime;
  isBotRunning = true;

  try {
    const today = new Date().toLocaleDateString('en-GB');
    await Submission.deleteMany({ date: today, batch });
    await Student.deleteMany({ batch });
    await Student.insertMany(students.map(s => ({ ...s, batch })));

    const [hours, minutes] = reportTime.split(':');
    const cronExpression = `${minutes} ${hours} * * *`;

    if (reportCron) reportCron.stop();

    reportCron = cron.schedule(cronExpression, () => {
      generateReport();
    }, {
      scheduled: true,
      timezone: 'Asia/Kolkata'
    });
    console.log(`Cron job scheduled for ${reportTime} IST`);
    console.log(`Submission window set to ${submissionStartTime} - ${reportTime} IST for batch ${batch}`);

    res.json({ success: true, groupId, batch, reportTime, startTime });
  } catch (error) {
    console.error('Error saving setup:', error);
    res.status(500).json({ error: 'Failed to save setup' });
  }
});

app.post('/stop', async (req, res) => {
  if (!isAuthenticated || !isBotRunning) {
    return res.status(400).json({ error: 'Bot is not running or not authenticated' });
  }

  try {
    if (reportCron) {
      reportCron.stop();
      console.log('Cron job stopped');
    }
    isBotRunning = false;
    groupId = null;
    res.json({ success: true, message: 'Bot stopped successfully' });
  } catch (error) {
    console.error('Error stopping bot:', error);
    res.status(500).json({ error: 'Failed to stop bot' });
  }
});

async function updateSubmission(whatsappId, date) {
  let submission = await Submission.findOne({ date, batch });
  if (!submission) {
    submission = new Submission({ date, batch, submitted: [] });
  }
  if (!submission.submitted.includes(whatsappId)) {
    submission.submitted.push(whatsappId);
    await submission.save();
    console.log('Submission saved:', submission);
  }
}

async function generateReport() {
  if (!groupId || !isBotRunning) return;
  const today = new Date().toLocaleDateString('en-GB');
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const students = await Student.find({ batch });
  const submission = await Submission.findOne({ date: today, batch }) || { submitted: [] };

  const submitted = students.filter((s) => submission.submitted.includes(s.whatsappId));
  const notSubmitted = students.filter((s) => !submission.submitted.includes(s.whatsappId));

  const report = `
Daily Task Report
------------------------------
Batch: ${batch}
Day: ${dayName}
Date: ${today}
------------------------------
Submitted:
${submitted.map((s) => `✅ ${s.name}`).join('\n')}
Not Submitted:
${notSubmitted.map((s) => `❌ ${s.name}`).join('\n')}
Consistency leads to success. Great job to those who submitted, keep the momentum going! 🎯
  `.trim();

  await client.sendMessage(groupId, report);
  console.log('Report sent:', report);
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});