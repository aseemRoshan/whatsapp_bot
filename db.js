const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect('mongodb+srv://Ecommerse:aseem7771@cluster0.bamqt.mongodb.net/Whatsapp_bot?retryWrites=true&w=majority&appName=Cluster0');
    console.log('MongoDB Connected');
  } catch (error) {
    console.error('MongoDB Connection Error:', error);
    process.exit(1);
  }
};

module.exports = connectDB;