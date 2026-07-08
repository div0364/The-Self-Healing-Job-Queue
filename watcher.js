
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

const SERVER_SCRIPT = path.join(__dirname, 'server.js');
const RESTART_EXIT_CODE = 99;
const RESTART_DELAY_MS = 1000; 

let restartCount = 0;

function startServer() {
  console.log(`[Watcher] Starting server.js (restart #${restartCount})...`);

  const child = spawn('node', [SERVER_SCRIPT], {
    stdio: 'inherit',
    cwd: __dirname
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[Watcher] server.js was killed by signal ${signal}. Not restarting.`);
      return;
    }

    if (code === RESTART_EXIT_CODE) {
      restartCount++;
      console.log(`\n[Watcher] server.js exited with code ${RESTART_EXIT_CODE} (CPU overload restart signal).`);
      console.log(`[Watcher] Restarting in ${RESTART_DELAY_MS}ms... (restart count: ${restartCount})\n`);
      setTimeout(startServer, RESTART_DELAY_MS);
    } else if (code === 0) {
      console.log(`[Watcher] server.js exited cleanly (code 0). Not restarting.`);
    } else {
      console.error(`[Watcher] server.js exited with unexpected code ${code}. Restarting in ${RESTART_DELAY_MS}ms...`);
      setTimeout(startServer, RESTART_DELAY_MS);
    }
  });

  child.on('error', (err) => {
    console.error('[Watcher] Failed to start server.js:', err);
    console.log(`[Watcher] Retrying in ${RESTART_DELAY_MS}ms...`);
    setTimeout(startServer, RESTART_DELAY_MS);
  });
}

console.log('=========================================');
console.log('[Watcher] Process Manager starting...');
console.log(`[Watcher] PID: ${process.pid}`);
console.log(`[Watcher] Server script: ${SERVER_SCRIPT}`);
console.log(`[Watcher] Restart signal: exit code ${RESTART_EXIT_CODE}`);
console.log('=========================================');

startServer();
