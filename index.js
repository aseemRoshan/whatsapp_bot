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

// Map to store WhatsApp clients per user
const clients = new Map(); // Key: userId, Value: { client, isAuthenticated, qrCodeData }
const reportCron = {}; // Map to store cron jobs per user

// Function to initialize a WhatsApp client for a specific user
function initializeClient(userId) {
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: `whatsapp-session-${userId}` })
  });

  let qrCodeData = null;
  let isAuthenticated = false;

  client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
      if (err) console.error(`Error generating QR code for user ${userId}:`, err);
      else {
        qrCodeData = url;
        console.log(`QR code generated for user ${userId}`);
        io.to(userId).emit('qr', { qr: qrCodeData });
      }
    });
  });

  client.on('ready', async () => {
    console.log(`WhatsApp Bot is ready for user ${userId}!`);
    isAuthenticated = true;
    clients.set(userId, { client, isAuthenticated, qrCodeData });

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

    io.to(userId).emit('authenticated', {
      message: 'User authenticated successfully',
      groups,
      contacts: contactList
    });
  });

  client.on('message_create', async (msg) => {
    if (!isAuthenticated) return;

    // Determine the group ID from the message
    const groupId = msg.to.endsWith('@g.us') ? msg.to : msg.from.endsWith('@g.us') ? msg.from : null;
    if (!groupId) return; // Ignore non-group messages

    // Fetch the user's setup only if the group matches
    const userSetup = await UserSetup.findOne({ userId, groupId, isBotRunning: true });
    if (!userSetup) {
      console.log(`No active setup found for user ${userId} in group ${groupId}`);
      return;
    }

    console.log(`[DEBUG] Message processed for user ${userId} - Type: ${msg.type}, From: ${msg.from}, To: ${msg.to}, Author: ${msg.author || 'undefined'}`);

    if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
      const botUserId = client.info.wid._serialized;
      let whatsappId = msg.author || botUserId;

      const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
      const currentDateTime = new Date(now);
      const timeInMinutes = currentDateTime.getHours() * 60 + currentDateTime.getMinutes();
      const submissionDate = currentDateTime.toLocaleDateString('en-GB');

      const [startHours, startMinutes] = userSetup.startTime.split(':').map(Number);
      const [endHours, endMinutes] = userSetup.reportTime.split(':').map(Number);
      const startTime = startHours * 60 + startMinutes;
      const endTime = endHours * 60 + endMinutes;

      console.log(`[DEBUG] Time check for user ${userId}: Current ${timeInMinutes}, Window ${startTime} - ${endTime}`);

      if (timeInMinutes < startTime || timeInMinutes > endTime) {
        console.log(`Audio submission from ${whatsappId} ignored for user ${userId} - Outside valid window (${userSetup.startTime} - ${userSetup.reportTime} IST)`);
        return;
      }

      try {
        const student = await Student.findOne({ whatsappId, batch: userSetup.batch });
        if (student) {
          await updateSubmission(whatsappId, submissionDate, userId);
          console.log(`${student.name} (${whatsappId}) submitted an audio counted for ${submissionDate} for user ${userId}`);
        } else {
          console.log(`No student found with whatsappId ${whatsappId} in batch ${userSetup.batch} for user ${userId}`);
        }
      } catch (error) {
        console.error(`Error processing submission for ${whatsappId} for user ${userId}:`, error);
      }
    }
  });

  client.on('disconnected', (reason) => {
    console.log(`Client for user ${userId} disconnected: ${reason}`);
    isAuthenticated = false;
    clients.set(userId, { client, isAuthenticated, qrCodeData });
  });

  client.initialize().catch(err => console.error(`Error initializing client for user ${userId}:`, err));
  clients.set(userId, { client, isAuthenticated, qrCodeData });
  return client;
}

// Middleware to get user-specific client
const getClientForUser = (req) => {
  const userId = req.user.uid;
  if (!clients.has(userId)) {
    initializeClient(userId);
  }
  return clients.get(userId);
};

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('hello', (res) => {
    console.log('Hello response:', res);
  });

  socket.on('register-user', (userId) => {
    socket.join(userId);
    if (!clients.has(userId)) {
      initializeClient(userId);
    } else if (clients.get(userId).isAuthenticated) {
      const { client } = clients.get(userId);
      client.emit('ready');
    }
  });
});

// Authentication Routes
app.post('/auth/verify', authenticateToken, (req, res) => {
  res.json({ success: true, message: 'User authenticated' });
});

// Check user status
app.get('/user-status', authenticateToken, async (req, res) => {
  const userId = req.user.uid;
  const userSetup = await UserSetup.findOne({ userId });
  const userClient = getClientForUser(req);

  if (userClient.isAuthenticated) {
    const chats = await userClient.client.getChats();
    const groups = chats.filter(chat => chat.id._serialized.endsWith('@g.us')).map(group => ({
      name: group.name || 'Unnamed Group',
      id: group.id._serialized
    }));
    const contacts = await userClient.client.getContacts();
    const contactList = contacts
      .filter(contact => contact.isMyContact && contact.number && contact.id._serialized.endsWith('@c.us'))
      .map(contact => ({
        name: contact.name || contact.pushname || contact.number,
        id: contact.id._serialized
      }));

    res.json({
      authenticated: true,
      hasSetup: !!userSetup,
      setup: userSetup ? {
        groupId: userSetup.groupId,
        batch: userSetup.batch,
        reportTime: userSetup.reportTime,
        startTime: userSetup.startTime,
        students: userSetup.students,
        isBotRunning: userSetup.isBotRunning
      } : null,
      groups,
      contacts: contactList
    });
  } else {
    res.json({ authenticated: false, qr: userClient.qrCodeData });
  }
});

app.get('/qr', authenticateToken, (req, res) => {
  const userClient = getClientForUser(req);
  if (userClient.qrCodeData) {
    res.json({ qr: userClient.qrCodeData });
  } else if (userClient.isAuthenticated) {
    res.json({ authenticated: true });
  } else {
    res.status(503).json({ error: 'QR code not yet generated' });
  }
});

app.post('/setup', authenticateToken, async (req, res) => {
  const userId = req.user.uid;
  const userClient = getClientForUser(req);
  if (!userClient.isAuthenticated) return res.status(401).json({ error: 'Not authenticated' });

  const { groupId, batch, reportTime, startTime, students } = req.body;

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

    const today = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }).split(',')[0];
    await Submission.deleteMany({ date: today, batch });
    await Student.deleteMany({ batch });
    await Student.insertMany(students.map(s => ({ ...s, batch })));

    const [hours, minutes] = reportTime.split(':');
    const cronExpression = `${minutes} ${hours} * * *`;

    if (reportCron[userId]) {
      reportCron[userId].stop();
      delete reportCron[userId];
    }

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

app.post('/logout', authenticateToken, async (req, res) => {
  const userId = req.user.uid;
  const userClient = clients.get(userId);
  if (userClient) {
    await userClient.client.destroy();
    clients.delete(userId);
  }
  if (reportCron[userId]) {
    reportCron[userId].stop();
    delete reportCron[userId];
  }
  res.json({ success: true, message: 'Logged out successfully' });
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
    console.log(`Submission saved for user ${userId}:`, submission);
  }
}

async function generateReport(userId) {
  const userSetup = await UserSetup.findOne({ userId });
  if (!userSetup || !userSetup.groupId || !userSetup.isBotRunning) {
    console.log(`Cannot generate report for user ${userId}: No active setup`);
    return;
  }
  const userClient = clients.get(userId);
  if (!userClient || !userClient.isAuthenticated) {
    console.log(`Cannot generate report for user ${userId}: Client not authenticated`);
    return;
  }

  const today = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const todayFormatted = new Date(today).toLocaleDateString('en-GB');
  const dayName = new Date(today).toLocaleDateString('en-US', { weekday: 'long' });
  const students = await Student.find({ batch: userSetup.batch });
  const submission = await Submission.findOne({ date: todayFormatted, batch: userSetup.batch }) || { submitted: [] };

  const submitted = students.filter((s) => submission.submitted.includes(s.whatsappId));
  const notSubmitted = students.filter((s) => !submission.submitted.includes(s.whatsappId));

  const report = `
Daily Task Report
------------------------------
Batch: ${userSetup.batch}
Day: ${dayName}
Date: ${todayFormatted}
------------------------------
Submitted:
${submitted.map((s) => `✅ ${s.name}`).join('\n')}
Not Submitted:
${notSubmitted.map((s) => `❌ ${s.name}`).join('\n')}
Consistency leads to success. Great job to those who submitted, keep the momentum going! 🎯
  `.trim();

  try {
    await userClient.client.sendMessage(userSetup.groupId, report);
    console.log(`Report sent for user ${userId}:`, report);
  } catch (error) {
    console.error(`Error sending report for user ${userId}:`, error);
  }
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});