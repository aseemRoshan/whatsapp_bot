const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const connectDB = require('./db');
const Student = require('./models/Student');
const Submission = require('./models/Submission');
const UserSetup = require('./models/UserSetup');
const cron = require('node-cron');
const http = require('http');
const qrcode = require('qrcode');
const socketIo = require('socket.io');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Initialize Firebase Admin
const serviceAccount = require('./whatsapp-audio-tracker-firebase-adminsdk-fbsvc-54842ff617.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Middleware to verify Firebase token
const authenticateToken = async (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1] || req.body.idToken;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Connect to MongoDB
connectDB();

// Initialize WhatsApp Client with session persistence
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'whatsapp-session' })
});
let qrCodeData = null;
let isAuthenticated = false;
let reportCron = {}; // Map to store cron jobs per user

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

  if (io.sockets.sockets.size > 0) {
    const chats = await client.getChats();
    const groups = chats.filter(chat => chat.id._serialized.endsWith('@g.us')).map(group => ({
      name: group.name || 'Unnamed Group',
      id: group.id._serialized
    }));
    const contacts = await client.getContacts();
    const contactList = contacts
      .filter(contact => contact.isMyContact && contact.number && contact.id._serialized.endsWith('@c.us'))
      .map(contact => ({
        name: contact.name || contact.pushname || contact.number,
        id: contact.id._serialized
      }));

    io.emit('authenticated', {
      message: 'User authenticated successfully',
      groups,
      contacts: contactList
    });
  }
});

client.on('message_create', async (msg) => {
  if (!isAuthenticated) return;
  console.log(`[DEBUG] Message created - Type: ${msg.type}, From: ${msg.from}, To: ${msg.to}, Author: ${msg.author || 'undefined'}`);

  if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
    const userSetups = await UserSetup.find({ groupId: { $in: [msg.from, msg.to] }, isBotRunning: true });
    if (!userSetups.length) return;

    const botUserId = client.info.wid._serialized;
    let whatsappId = msg.author || botUserId;

    const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const currentDateTime = new Date(now);
    const timeInMinutes = currentDateTime.getHours() * 60 + currentDateTime.getMinutes();
    const submissionDate = currentDateTime.toLocaleDateString('en-GB');

    for (const userSetup of userSetups) {
      const [startHours, startMinutes] = userSetup.startTime.split(':').map(Number);
      const [endHours, endMinutes] = userSetup.reportTime.split(':').map(Number);
      const startTime = startHours * 60 + startMinutes;
      const endTime = endHours * 60 + endMinutes;

      if (timeInMinutes < startTime || timeInMinutes > endTime) {
        console.log(`Audio submission from ${whatsappId} ignored - Outside valid window (${userSetup.startTime} - ${userSetup.reportTime} IST)`);
        continue;
      }

      try {
        const student = await Student.findOne({ whatsappId, batch: userSetup.batch });
        if (student) {
          await updateSubmission(whatsappId, submissionDate, userSetup.userId);
          console.log(`${student.name} (${whatsappId}) submitted an audio counted for ${submissionDate}`);
        }
      } catch (error) {
        console.error(`Error processing submission for ${whatsappId}:`, error);
      }
    }
  }
});

client.initialize();

// Authentication Routes
app.post('/auth/verify', authenticateToken, (req, res) => {
  res.json({ success: true, message: 'User authenticated' });
});

// Check user status
app.get('/user-status', authenticateToken, async (req, res) => {
  const userId = req.user.uid;
  const userSetup = await UserSetup.findOne({ userId });

  if (isAuthenticated && userSetup && userSetup.groupId) {
    const chats = await client.getChats();
    const groups = chats.filter(chat => chat.id._serialized.endsWith('@g.us')).map(group => ({
      name: group.name || 'Unnamed Group',
      id: group.id._serialized
    }));
    const contacts = await client.getContacts();
    const contactList = contacts
      .filter(contact => contact.isMyContact && contact.number && contact.id._serialized.endsWith('@c.us'))
      .map(contact => ({
        name: contact.name || contact.pushname || contact.number,
        id: contact.id._serialized
      }));

    res.json({
      authenticated: true,
      hasSetup: true,
      setup: {
        groupId: userSetup.groupId,
        batch: userSetup.batch,
        reportTime: userSetup.reportTime,
        startTime: userSetup.startTime,
        students: userSetup.students,
        isBotRunning: userSetup.isBotRunning
      },
      groups,
      contacts: contactList
    });
  } else if (isAuthenticated) {
    res.json({ authenticated: true, hasSetup: false });
  } else {
    res.json({ authenticated: false, qr: qrCodeData });
  }
});

app.get('/qr', authenticateToken, (req, res) => {
  if (qrCodeData) {
    res.json({ qr: qrCodeData });
  } else if (isAuthenticated) {
    res.json({ authenticated: true });
  } else {
    res.status(503).json({ error: 'QR code not yet generated' });
  }
});

app.post('/setup', authenticateToken, async (req, res) => {
  if (!isAuthenticated) return res.status(401).json({ error: 'Not authenticated' });
  const { groupId, batch, reportTime, startTime, students } = req.body;
  const userId = req.user.uid;

  if (!groupId || !batch || !reportTime || !startTime || !students || !Array.isArray(students)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  for (const student of students) {
    if (!student.whatsappId.match(/^\d+@c\.us$/)) {
      return res.status(400).json({ error: `Invalid WhatsApp ID format for ${student.name}: ${student.whatsappId}` });
    }
  }

  const [startHours, startMinutes] = startTime.split(':').map(Number);
  const [reportHours, reportMinutes] = reportTime.split(':').map(Number);
  const startInMinutes = startHours * 60 + startMinutes;
  const reportInMinutes = reportHours * 60 + reportMinutes;
  if (startInMinutes >= reportInMinutes) {
    return res.status(400).json({ error: 'Start time must be before report time' });
  }

  try {
    await UserSetup.findOneAndUpdate(
      { userId },
      { groupId, batch, reportTime, startTime, students, isBotRunning: true },
      { upsert: true, new: true }
    );

    const today = new Date().toLocaleDateString('en-GB');
    await Submission.deleteMany({ date: today, batch });
    await Student.deleteMany({ batch });
    await Student.insertMany(students.map(s => ({ ...s, batch })));

    const [hours, minutes] = reportTime.split(':');
    const cronExpression = `${minutes} ${hours} * * *`;

    if (reportCron[userId]) reportCron[userId].stop();

    reportCron[userId] = cron.schedule(cronExpression, () => {
      generateReport(userId);
    }, {
      scheduled: true,
      timezone: 'Asia/Kolkata'
    });

    console.log(`Cron job scheduled for ${reportTime} IST for user ${userId}`);
    res.json({ success: true, groupId, batch, reportTime, startTime });
  } catch (error) {
    console.error('Error saving setup:', error);
    res.status(500).json({ error: 'Failed to save setup' });
  }
});

app.post('/stop', authenticateToken, async (req, res) => {
  const userId = req.user.uid;
  const userSetup = await UserSetup.findOne({ userId });
  if (!userSetup || !userSetup.isBotRunning) {
    return res.status(400).json({ error: 'Bot is not running or not authenticated' });
  }

  try {
    if (reportCron[userId]) {
      reportCron[userId].stop();
      delete reportCron[userId];
      console.log('Cron job stopped for user:', userId);
    }
    await UserSetup.updateOne({ userId }, { isBotRunning: false });
    res.json({ success: true, message: 'Bot stopped successfully' });
  } catch (error) {
    console.error('Error stopping bot:', error);
    res.status(500).json({ error: 'Failed to stop bot' });
  }
});

async function updateSubmission(whatsappId, date, userId) {
  const userSetup = await UserSetup.findOne({ userId });
  if (!userSetup || !userSetup.isBotRunning) return;
  let submission = await Submission.findOne({ date, batch: userSetup.batch });
  if (!submission) {
    submission = new Submission({ date, batch: userSetup.batch, submitted: [] });
  }
  if (!submission.submitted.includes(whatsappId)) {
    submission.submitted.push(whatsappId);
    await submission.save();
    console.log('Submission saved:', submission);
  }
}

async function generateReport(userId) {
  const userSetup = await UserSetup.findOne({ userId });
  if (!userSetup || !userSetup.groupId || !userSetup.isBotRunning) return;
  const today = new Date().toLocaleDateString('en-GB');
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const students = await Student.find({ batch: userSetup.batch });
  const submission = await Submission.findOne({ date: today, batch: userSetup.batch }) || { submitted: [] };

  const submitted = students.filter((s) => submission.submitted.includes(s.whatsappId));
  const notSubmitted = students.filter((s) => !submission.submitted.includes(s.whatsappId));

  const report = `
Daily Task Report
------------------------------
Batch: ${userSetup.batch}
Day: ${dayName}
Date: ${today}
------------------------------
Submitted:
${submitted.map((s) => `✅ ${s.name}`).join('\n')}
Not Submitted:
${notSubmitted.map((s) => `❌ ${s.name}`).join('\n')}
Consistency leads to success. Great job to those who submitted, keep the momentum going! 🎯
  `.trim();

  await client.sendMessage(userSetup.groupId, report);
  console.log('Report sent:', report);
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});