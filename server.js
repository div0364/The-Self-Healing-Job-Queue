require('dotenv').config();
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'server.log');
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function writeToLogFile(type, args) {
  const msg = `[${new Date().toISOString()}] [${type}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}\n`;
  try {
    fs.appendFileSync(logFile, msg);
  } catch (err) {
    
  }
}

console.log = (...args) => {
  originalLog(...args);
  writeToLogFile('INFO', args);
};
console.error = (...args) => {
  originalError(...args);
  writeToLogFile('ERROR', args);
};
console.warn = (...args) => {
  originalWarn(...args);
  writeToLogFile('WARN', args);
};
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const os = require('os');
const { spawn } = require('child_process');
const { ScheduledMessage, Message } = require('./models');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/project2_db';


let lastProcessCpu = process.cpuUsage();
let lastTime = process.hrtime();
let lastSystemCpu = getSystemCpuInfo();
let consecutiveHighCpuCount = 0;
const CPU_THRESHOLD = 70; // 70% utilization
const STRIKES_REQUIRED = 3; // Number of consecutive high checks before restart
const CHECK_INTERVAL_MS = 2000; // Check CPU every 2 seconds
const STARTUP_GRACE_PERIOD_MS = 15000; // 15s grace period at startup
const startupTime = Date.now();
let isRestarting = false;


mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB database');
    startScheduler(); 
  })
  .catch(err => console.error('MongoDB connection error:', err));


function parseDayAndTime(day, time) {
  const dayLower = String(day).trim().toLowerCase();
  const timeStr = String(time).trim();
  
  let targetDate = new Date();
  

  if (dayLower === 'today') {
   
  } else if (dayLower === 'tomorrow') {
    targetDate.setDate(targetDate.getDate() + 1);
  } else {
    
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDayIndex = weekdays.indexOf(dayLower);
    
    if (targetDayIndex !== -1) {
      const currentDayIndex = targetDate.getDay();
      let daysToAdd = targetDayIndex - currentDayIndex;
      if (daysToAdd <= 0) {
        daysToAdd += 7; 
      }
      targetDate.setDate(targetDate.getDate() + daysToAdd);
    } else {
      
      const parsedDay = new Date(day);
      if (!isNaN(parsedDay.getTime())) {
        targetDate = parsedDay;
      } else {
        const directCombined = new Date(`${day} ${time}`);
        if (!isNaN(directCombined.getTime())) {
          return directCombined;
        }
        throw new Error(`Invalid day format: ${day}`);
      }
    }
  }
  
  
  const timeRegex = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i;
  const match = timeStr.match(timeRegex);
  
  if (match) {
    let [_, hours, minutes, seconds, ampm] = match;
    hours = parseInt(hours, 10);
    minutes = parseInt(minutes, 10);
    seconds = seconds ? parseInt(seconds, 10) : 0;
    
    if (ampm) {
      const ampmLower = ampm.toLowerCase();
      if (ampmLower === 'pm' && hours < 12) {
        hours += 12;
      } else if (ampmLower === 'am' && hours === 12) {
        hours = 0;
      }
    }
    
    targetDate.setHours(hours, minutes, seconds, 0);
  } else {
    const combined = new Date(`${day} ${time}`);
    if (!isNaN(combined.getTime())) {
      return combined;
    }
    throw new Error(`Invalid time format: ${time}`);
  }
  
  return targetDate;
}


app.get('/api/health', (req, res) => {
  const cpuInfo = getCpuUsage();
  res.json({
    status: 'running',
    pid: process.pid,
    uptime: Math.round((Date.now() - startupTime) / 1000),
    cpu: cpuInfo,
    consecutiveHighCpuChecks: consecutiveHighCpuCount
  });
});


app.get('/api/messages/scheduled', async (req, res) => {
  try {
    const messages = await ScheduledMessage.find().sort({ scheduledAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.find().sort({ createdAt: -1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/messages/schedule', async (req, res) => {
  const { message, day, time } = req.body;
  
  if (!message || !day || !time) {
    return res.status(400).json({ error: 'Parameters "message", "day", and "time" are required.' });
  }
  
  try {
    const scheduledAt = parseDayAndTime(day, time);
    
    const newMessage = await ScheduledMessage.create({
      message,
      scheduledAt,
      status: 'pending'
    });
    
    res.status(201).json({
      success: true,
      message: 'Message successfully scheduled.',
      data: newMessage
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


app.post('/api/test/cpu-stress', (req, res) => {
  const durationMs = req.body.duration || 8000;
  console.log(`[STRESS TEST] Starting CPU stress loop for ${durationMs}ms...`);
  
  res.json({
    message: `CPU stress initiated for ${durationMs}ms. This will block/yield CPU to simulate high usage. Check logs shortly.`
  });
  
  const endTime = Date.now() + durationMs;
  function work() {
    const sliceEnd = Date.now() + 40;
    while (Date.now() < sliceEnd) {
      Math.sqrt(Math.random() * 100000);
    }
    if (Date.now() < endTime) {
      setImmediate(work); 
    }
  }
  work();
});

function startScheduler() {
  console.log('[Scheduler] Background scheduler started.');
  setInterval(async () => {
    
    if (mongoose.connection.readyState !== 1) {
      console.warn('[Scheduler] DB not ready, skipping poll.');
      return;
    }
    try {
      const now = new Date();
   
      const pending = await ScheduledMessage.find({
        status: 'pending',
        scheduledAt: { $lte: now }
      });
      
      for (const msg of pending) {
        try {
          console.log(`[Scheduler] Processing message (ID: ${msg._id}): "${msg.message}" at target time ${msg.scheduledAt}`);
          
        
          await Message.create({
            message: msg.message,
            insertedAt: msg.scheduledAt
          });
          
          
          msg.status = 'completed';
          await msg.save();
          console.log(`[Scheduler] Message successfully inserted (ID: ${msg._id})`);
        } catch (err) {
          console.error(`[Scheduler] Failed to process message ${msg._id}:`, err);
          msg.status = 'failed';
          msg.error = err.message;
          await msg.save();
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error checking scheduled messages:', err);
    }
  }, 5000);
}


function getSystemCpuInfo() {
  const cpus = os.cpus();
  if (!cpus || cpus.length === 0) return { idle: 0, total: 0 };
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      total += cpu.times[type];
    }
    idle += cpu.times.idle;
  }
  return { idle: idle / cpus.length, total: total / cpus.length };
}

function getCpuUsage() {
  
  const currentProcessCpu = process.cpuUsage();
  const currentTime = process.hrtime();
  
  const userDiff = currentProcessCpu.user - lastProcessCpu.user;
  const sysDiff = currentProcessCpu.system - lastProcessCpu.system;
  const totalProcessMicroseconds = userDiff + sysDiff;
  
  const elapsedHrTime = process.hrtime(lastTime);
  const elapsedMicroseconds = (elapsedHrTime[0] * 1e6) + (elapsedHrTime[1] / 1e3);
  
  lastProcessCpu = currentProcessCpu;
  lastTime = currentTime;
  
  const totalCapacity = elapsedMicroseconds;
  const processPercentage = totalCapacity > 0 ? (totalProcessMicroseconds / totalCapacity) * 100 : 0;
  

  const currentSystemCpu = getSystemCpuInfo();
  const idleDiff = currentSystemCpu.idle - lastSystemCpu.idle;
  const totalDiff = currentSystemCpu.total - lastSystemCpu.total;
  lastSystemCpu = currentSystemCpu;
  
  const systemPercentage = totalDiff > 0 ? 100 - (100 * idleDiff / totalDiff) : 0;
  
  return {
    process: Math.min(100, Math.round(processPercentage)),
    system: Math.min(100, Math.round(systemPercentage))
  };
}

setInterval(() => {
  const uptimeMs = Date.now() - startupTime;
  if (uptimeMs < STARTUP_GRACE_PERIOD_MS) {
  
    getCpuUsage();
    return;
  }
  
  const cpu = getCpuUsage();
  

  const shouldLog = cpu.process > 15 || Math.floor((Date.now() - startupTime) / CHECK_INTERVAL_MS) % 5 === 0;
  if (shouldLog) {
    console.log(`[CPU Monitor] Process CPU: ${cpu.process}%, System CPU: ${cpu.system}% (Uptime: ${Math.round(uptimeMs/1000)}s)`);
  }
  
  
  if (cpu.process >= CPU_THRESHOLD) {
    consecutiveHighCpuCount++;
    console.warn(`[WARNING] CPU usage of process is at ${cpu.process}%! Strike ${consecutiveHighCpuCount}/${STRIKES_REQUIRED}`);
    
    if (consecutiveHighCpuCount >= STRIKES_REQUIRED) {
      triggerGracefulShutdown();
    }
  } else {
    consecutiveHighCpuCount = 0; 
  }
}, CHECK_INTERVAL_MS);


function triggerGracefulShutdown() {
  if (isRestarting) return;
  isRestarting = true;

  console.error(`\n=========================================`);
  console.error(`[ALERT] CPU sustained above ${CPU_THRESHOLD}% threshold!`);
  console.error(`[ALERT] Performing graceful shutdown for restart by watcher...`);
  console.error(`=========================================\n`);


  const shutdownTimeout = setTimeout(() => {
    console.error('[ALERT] Force exiting due to shutdown timeout.');
    process.exit(99);
  }, 5000);
  shutdownTimeout.unref();

  const closeServer = new Promise((resolve) => {
    if (global.serverInstance) {
      global.serverInstance.close(() => {
        console.log('[Shutdown] Express server closed.');
        resolve();
      });
    } else {
      resolve();
    }
  });

  closeServer
    .then(() => mongoose.connection.close())
    .then(() => {
      console.log('[Shutdown] MongoDB connection closed. Exiting with code 99 for watcher restart...');
      process.exit(99);
    })
    .catch((err) => {
      console.error('[Shutdown] Error during graceful shutdown:', err);
      process.exit(99);
    });
}





function startServer() {
  const server = app.listen(PORT);
  
  server.on('listening', () => {
    console.log(`=========================================`);
    console.log(`Server running on port ${PORT}`);
    console.log(`Process PID: ${process.pid}`);
    console.log(`MongoDB URI: ${MONGODB_URI}`);
    console.log(`Grace period: ${STARTUP_GRACE_PERIOD_MS / 1000}s`);
    console.log(`=========================================`);
  });
  
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Port Bind] Port ${PORT} is in use. Retrying in 1 second...`);
      setTimeout(() => {
        server.close();
        startServer();
      }, 1000);
    } else {
      console.error('[Server Error] Failed to start server:', err);
    }
  });
  
  global.serverInstance = server;
}

startServer();
