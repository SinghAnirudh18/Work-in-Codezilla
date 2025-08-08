const mongoose = require('mongoose');
require('dotenv').config()
const MONGODB_URI = 'mongodb://localhost:27017/codezilla' ;

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Optional: handle connection events for better logging
const db = mongoose.connection;
db.on('error', (err) => console.error('MongoDB error:', err));
db.once('open', () => console.log('MongoDB connection is open'));

module.exports = db;
