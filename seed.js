const connectDB = require('./db');
const Student = require('./models/Student');

const students = [
  { name: 'Akash', batch: 'BCK221 A', whatsappId: '916282551479@c.us' }, 
  { name: 'Abhishek', batch: 'BCK221 A', whatsappId: '918590613068@c.us' },
  { name: 'Amruth', batch: 'BCK221 A', whatsappId: '918590797504@c.us' }, 
  { name: 'Irthah', batch: 'BCK221 A', whatsappId: '919400511584@c.us' },
  { name: 'Anees', batch: 'BCK221 A', whatsappId: '919995160852@c.us' }, 
  { name: 'Aseem', batch: 'BCK221 A', whatsappId: '919778137771@c.us' }, 
  { name: 'Midlaj', batch: 'BCK221 A', whatsappId: '917306180183@c.us' },
  { name: 'Jobhish', batch: 'BCK221 A', whatsappId: '917306061080@c.us' },
  { name: 'Ashique', batch: 'BCK221 A', whatsappId: '919446554721@c.us' }, 
  { name: 'Aswin', batch: 'BCK221 A', whatsappId: '918590740457@c.us' },
  { name: 'Faique', batch: 'BCK221 A', whatsappId: '919188302552@c.us' },
  { name: 'Chithira', batch: 'BCK221 A', whatsappId: '918301052208@c.us' },
  { name: 'Lena', batch: 'BCK221 A', whatsappId: '919778084868@c.us' }, 
  { name: 'Archana', batch: 'BCK221 A', whatsappId: '918075814312@c.us' }, 
  { name: 'Ajnas', batch: 'BCK221 A', whatsappId: '919778232935@c.us' },
];

async function seedDB() {
  await connectDB();
  await Student.deleteMany({ batch: 'BCK221 A' }); // Clear existing data
  await Student.insertMany(students);
  console.log('Students added to database');
  process.exit();
}

seedDB();