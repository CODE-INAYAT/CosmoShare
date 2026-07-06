// CosmoShare Signaling Server Load Test Script
// Supports testing Hugging Face Spaces (Socket.IO) and Cloudflare Workers (Raw WS)
// Simulates user connections, room joining, WebRTC negotiation, and sharing actions.

import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { io } from 'socket.io-client';

// ============================================================================
// CONFIGURATION FLAGS
// ============================================================================
const TEST_HUGGING_FACE = true;       // Test Hugging Face Spaces (Socket.IO)
const TEST_CLOUDFLARE = false;        // Test Cloudflare Workers (Raw WS)

const NUM_ROOMS = 18;                  // Number of LabShare rooms to simulate
const NUM_STUDENTS_PER_ROOM = 100;      // Number of students per room
const INCLUDE_LAB_ADMINS = true;      // Include a lab admin in each room

const NUM_ONESHARE_USERS = 100;         // OneShare users to simulate
const ENABLE_MULTISHARE = true;       // Enable MultiShare sessions in OneShare
const NUM_MULTISHARE_SESSIONS = 50;    // Number of MultiShare sessions to create

const ENABLE_FILE_SHARING = true;     // Simulate file sharing (WebRTC + broadcast)
const ENABLE_LINK_SHARING = true;     // Simulate link sharing (WebRTC message)
const ENABLE_CODE_SHARING = true;     // Simulate code sharing (WebRTC message)

const TEST_DURATION_MS = 15000;       // Test run duration in milliseconds
const ACTION_INTERVAL_MS = 2000;      // Interval for users to perform actions

// ============================================================================
// COLOR TERMINAL LOGGING
// ============================================================================
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};

function log(msg, color = colors.reset) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`${colors.dim}[${time}]${colors.reset} ${color}${msg}${colors.reset}`);
}

// ============================================================================
// ENVIRONMENT VARIABLES LOADER
// ============================================================================
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    log('Warning: .env file not found in project root!', colors.yellow);
    return {};
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    env[key] = val;
  }
  return env;
}

const env = loadEnv();

// Resolving endpoints
const HF_URL = env.NEXT_PUBLIC_SIGNALING_HF || 'http://localhost:7860';
const HF_TOKEN = env.NEXT_PUBLIC_HF_TOKEN || '';
const CF_URL = env.NEXT_PUBLIC_SIGNALING_BASE_URL || 'wss://main-signal.inayatshaikh2006.workers.dev';
const ADMIN_PASSWORD = env.NEXT_PUBLIC_AUTO_LOGIN_PASSWORD || 'admin123';

// ============================================================================
// ROOMS LOADER FROM CONFIG
// ============================================================================
function loadRoomNumbers() {
  const roomsPath = path.resolve(process.cwd(), 'src/config/rooms.ts');
  if (!fs.existsSync(roomsPath)) {
    log('Warning: rooms.ts not found, using default room numbers', colors.yellow);
    return ["203", "204", "205", "214", "215", "220", "221", "222", "223", "304", "305", "306", "307", "308", "309", "310", "312", "317"];
  }
  try {
    const content = fs.readFileSync(roomsPath, 'utf8');
    const match = content.match(/export\s+const\s+roomNumbers\s*(:\s*string\[\])?\s*=\s*\[([\s\S]*?)\]/);
    if (!match) {
      log('Warning: Could not parse roomNumbers in rooms.ts', colors.yellow);
      return ["203", "204", "205", "214", "215", "220", "221", "222", "223", "304", "305", "306", "307", "308", "309", "310", "312", "317"];
    }
    const matches = match[2].match(/"([^"]+)"|'([^']+)'/g);
    if (!matches) return [];
    return matches.map(m => m.replace(/['"]/g, ''));
  } catch (err) {
    log(`Warning parsing rooms.ts: ${err.message}`, colors.yellow);
    return ["203", "204", "205", "214", "215", "220", "221", "222", "223", "304", "305", "306", "307", "308", "309", "310", "312", "317"];
  }
}

const allRoomNumbers = loadRoomNumbers();

// ============================================================================
// PERFORMANCE METRICS TRACKING
// ============================================================================
const stats = {
  connectionsAttempted: 0,
  connectionsSuccessful: 0,
  connectionsFailed: 0,
  messagesSent: 0,
  messagesReceived: 0,
  errorsCount: 0,
  latencies: [],
};

function recordLatency(ms) {
  stats.latencies.push(ms);
}

// ============================================================================
// SOCKET CLIENT ADAPTOR PATTERN
// ============================================================================
class WsClientAdaptor {
  constructor(url, token, id) {
    this.url = url;
    this.token = token;
    this.id = id;
    this.socket = null;
    this.listeners = new Map();
    this.connected = false;
  }

  connect() {
    stats.connectionsAttempted++;
    return new Promise((resolve, reject) => {
      const headers = {};
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }
      try {
        this.socket = new WebSocket(this.url, { headers });
      } catch (err) {
        stats.connectionsFailed++;
        reject(err);
        return;
      }

      this.socket.on('open', () => {
        this.connected = true;
        stats.connectionsSuccessful++;
        resolve();
        this._trigger('connect');
      });

      this.socket.on('message', (data) => {
        stats.messagesReceived++;
        try {
          const { event, data: eventData } = JSON.parse(data.toString());
          this._trigger(event, eventData);
        } catch (e) {
          // ignore invalid json
        }
      });

      this.socket.on('close', () => {
        this.connected = false;
        this._trigger('disconnect');
      });

      this.socket.on('error', (err) => {
        stats.errorsCount++;
        this._trigger('error', err);
        if (!this.connected) {
          stats.connectionsFailed++;
          reject(err);
        }
      });
    });
  }

  emit(event, data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      stats.messagesSent++;
      this.socket.send(JSON.stringify({ event, data }));
    }
  }

  on(event, cb) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(cb);
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
    }
  }

  _trigger(event, data) {
    const list = this.listeners.get(event) || [];
    for (const cb of list) {
      try { cb(data); } catch (e) { }
    }
  }
}

class SocketIoClientAdaptor {
  constructor(url, token, id) {
    this.url = url;
    this.token = token;
    this.id = id;
    this.socket = null;
    this.listeners = new Map();
  }

  connect() {
    stats.connectionsAttempted++;
    return new Promise((resolve, reject) => {
      try {
        this.socket = io(this.url, {
          path: '/api/socket/io',
          extraHeaders: this.token ? { Authorization: `Bearer ${this.token}` } : {},
          forceNew: true,
          transports: ['websocket'],
        });
      } catch (err) {
        stats.connectionsFailed++;
        reject(err);
        return;
      }

      this.socket.on('connect', () => {
        stats.connectionsSuccessful++;
        resolve();
        this._trigger('connect');
      });

      this.socket.on('connect_error', (err) => {
        stats.errorsCount++;
        this._trigger('error', err);
        if (this.socket.active === false || !this.socket.connected) {
          stats.connectionsFailed++;
          reject(err);
        }
      });

      this.socket.on('disconnect', () => {
        this._trigger('disconnect');
      });

      this.socket.onAny((event, ...args) => {
        stats.messagesReceived++;
        this._trigger(event, args[0]);
      });
    });
  }

  emit(event, data) {
    if (this.socket && this.socket.connected) {
      stats.messagesSent++;
      this.socket.emit(event, data);
    }
  }

  on(event, cb) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(cb);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }

  _trigger(event, data) {
    const list = this.listeners.get(event) || [];
    for (const cb of list) {
      try { cb(data); } catch (e) { }
    }
  }
}

// ============================================================================
// TEST IMPLEMENTATION SUITE
// ============================================================================
async function runLoadTest(name, url, isSocketIo, token) {
  log(`\n==================================================`, colors.bright);
  log(`STARTING LOAD TEST: ${name}`, colors.bright + colors.cyan);
  log(`Endpoint: ${url}`, colors.cyan);
  log(`Type: ${isSocketIo ? 'Socket.IO' : 'Raw WebSocket'}`, colors.cyan);
  log(`==================================================\n`, colors.bright);

  const activeClients = [];
  const roomUsersMap = new Map(); // roomNumber -> list of client instances
  const oneShareClients = [];

  // Helper to instantiate client
  function createClient(id) {
    if (isSocketIo) {
      return new SocketIoClientAdaptor(url, token, id);
    } else {
      // For Raw WS, construct appropriate room param if doing LabShare
      return new WsClientAdaptor(url, token, id);
    }
  }

  // 1. Setup LabShare clients (Students & Admins)
  const roomsToTest = allRoomNumbers.slice(0, NUM_ROOMS);
  log(`Connecting LabShare users: ${roomsToTest.length} rooms (${roomsToTest.join(', ')}), ${NUM_STUDENTS_PER_ROOM} students/room...`, colors.yellow);
  for (let idx = 0; idx < roomsToTest.length; idx++) {
    const roomNumber = roomsToTest[idx];
    const r = idx + 1; // Uniqueness index
    roomUsersMap.set(roomNumber, []);

    // Create Admin if enabled
    if (INCLUDE_LAB_ADMINS) {
      const adminId = `admin-room-${roomNumber}`;
      const adminClient = createClient(adminId);

      let wsUrl = url;
      if (!isSocketIo) {
        wsUrl = `${url.replace(/\/$/, '')}/ws?room=${roomNumber}`;
        adminClient.url = wsUrl;
      }

      try {
        await adminClient.connect();
        activeClients.push(adminClient);
        roomUsersMap.get(roomNumber).push(adminClient);

        // Authenticate admin
        adminClient.emit('admin-auth', {
          roomNumber,
          password: ADMIN_PASSWORD,
          admin: { id: adminId, name: `Lab Admin ${roomNumber}`, uniqueId: `ADMIN-${roomNumber}`, roomNumber },
        });

        // Listen for auth confirmation
        adminClient.on('admin-auth-success', () => {
          log(`Admin authenticated successfully for Room ${roomNumber}`, colors.green);
          adminClient.emit('join-room', {
            roomNumber,
            user: { id: adminId, name: `Lab Admin ${roomNumber}`, uniqueId: `ADMIN-${roomNumber}`, roomNumber },
          });
        });
      } catch (err) {
        log(`Failed to connect Admin for Room ${roomNumber}: ${err.message}`, colors.red);
      }
    }

    // Create Students
    for (let s = 1; s <= NUM_STUDENTS_PER_ROOM; s++) {
      const studentId = `student-r${roomNumber}-s${s}`;
      const studentClient = createClient(studentId);

      let wsUrl = url;
      if (!isSocketIo) {
        wsUrl = `${url.replace(/\/$/, '')}/ws?room=${roomNumber}`;
        studentClient.url = wsUrl;
      }

      try {
        await studentClient.connect();
        activeClients.push(studentClient);
        roomUsersMap.get(roomNumber).push(studentClient);

        const studentUser = {
          id: studentId,
          name: `Student ${s} (Room ${roomNumber})`,
          uniqueId: `STUDENT-R${roomNumber}-S${s}`,
          roomNumber,
        };

        studentClient.emit('join-room', { roomNumber, user: studentUser });
      } catch (err) {
        log(`Failed to connect student ${studentId}: ${err.message}`, colors.red);
      }
    }
  }

  // 2. Setup OneShare clients
  log(`Connecting OneShare users: ${NUM_ONESHARE_USERS} clients...`, colors.yellow);
  for (let o = 1; o <= NUM_ONESHARE_USERS; o++) {
    const oneShareId = `oneshare-user-${o}`;
    const oneShareClient = createClient(oneShareId);

    let wsUrl = url;
    if (!isSocketIo) {
      wsUrl = `${url.replace(/\/$/, '')}/ws?room=__oneshare__`;
      oneShareClient.url = wsUrl;
    }

    try {
      await oneShareClient.connect();
      activeClients.push(oneShareClient);
      oneShareClients.push(oneShareClient);
    } catch (err) {
      log(`Failed to connect OneShare client ${oneShareId}: ${err.message}`, colors.red);
    }
  }

  log(`Initialization complete. Active clients: ${activeClients.length}`, colors.green);

  // Setup messaging latency tracks
  const pendingSignals = new Map(); // msgId -> startTime

  // Register common message relay callbacks
  activeClients.forEach((client) => {
    client.on('webrtc-offer', (data) => {
      const key = `${data.senderId}-offer-${client.id}`;
      const start = pendingSignals.get(key);
      if (start) {
        recordLatency(Date.now() - start);
        pendingSignals.delete(key);
      }
      // Reply to offer automatically to exercise relay back
      client.emit('webrtc-answer', {
        targetId: data.senderId,
        answer: { sdp: 'dummy-sdp-answer' },
      });
    });

    client.on('webrtc-answer', (data) => {
      const key = `${data.senderId}-answer-${client.id}`;
      const start = pendingSignals.get(key);
      if (start) {
        recordLatency(Date.now() - start);
        pendingSignals.delete(key);
      }
    });

    client.on('oneshare-offer', (data) => {
      const key = `${data.senderId}-oneshare-offer-${client.id}`;
      const start = pendingSignals.get(key);
      if (start) {
        recordLatency(Date.now() - start);
        pendingSignals.delete(key);
      }
      client.emit('oneshare-answer', {
        targetId: data.senderId,
        answer: { sdp: 'dummy-oneshare-sdp-answer' },
        code: data.code,
      });
    });

    client.on('oneshare-answer', (data) => {
      const key = `${data.senderId}-oneshare-answer-${client.id}`;
      const start = pendingSignals.get(key);
      if (start) {
        recordLatency(Date.now() - start);
        pendingSignals.delete(key);
      }
    });

    client.on('oneshare-receiver-joined', (data) => {
      // Sender receives this and starts negotiation
      const sender = client;
      const receiverId = data.receiverId;
      const key = `${sender.id}-oneshare-offer-${receiverId}`;
      pendingSignals.set(key, Date.now());
      sender.emit('oneshare-offer', {
        targetId: receiverId,
        offer: { sdp: 'dummy-oneshare-sdp-offer' },
        code: data.code,
      });
    });
  });

  // Action loop: periodically trigger sharing and status requests
  const intervalId = setInterval(() => {
    // A. Simulate LabShare Actions
    roomUsersMap.forEach((usersInRoom, roomNumber) => {
      if (usersInRoom.length < 2) return;

      const students = usersInRoom.filter(c => !c.id.startsWith('admin-'));
      if (students.length < 2) return;

      // Select random sender and receiver
      const senderIdx = Math.floor(Math.random() * students.length);
      let receiverIdx = Math.floor(Math.random() * students.length);
      while (receiverIdx === senderIdx) {
        receiverIdx = (receiverIdx + 1) % students.length;
      }

      const sender = students[senderIdx];
      const receiver = students[receiverIdx];

      if (ENABLE_FILE_SHARING) {
        log(`[${roomNumber}] Student ${sender.id} sharing file notification with room...`, colors.magenta);
        sender.emit('file-share-request', {
          roomNumber,
          fileInfo: { fileName: 'test-document.pdf', fileSize: 1024 * 1024 * 5, fileType: 'application/pdf' },
        });

        // Trigger P2P signaling simulation
        const key = `${sender.id}-offer-${receiver.id}`;
        pendingSignals.set(key, Date.now());
        sender.emit('webrtc-offer', {
          targetId: receiver.id,
          offer: { sdp: 'dummy-sdp-offer' },
          roomNumber,
        });
      }

      if (ENABLE_LINK_SHARING) {
        log(`[${roomNumber}] Student ${sender.id} sharing link with Student ${receiver.id}...`, colors.magenta);
        const key = `${sender.id}-offer-${receiver.id}`;
        pendingSignals.set(key, Date.now());
        sender.emit('webrtc-offer', {
          targetId: receiver.id,
          offer: { sdp: 'dummy-link-sdp-offer', type: 'link', url: 'https://huggingface.co' },
          roomNumber,
        });
      }

      if (ENABLE_CODE_SHARING) {
        log(`[${roomNumber}] Student ${sender.id} sharing code snippet with Student ${receiver.id}...`, colors.magenta);
        const key = `${sender.id}-offer-${receiver.id}`;
        pendingSignals.set(key, Date.now());
        sender.emit('webrtc-offer', {
          targetId: receiver.id,
          offer: { sdp: 'dummy-code-sdp-offer', type: 'code', snippet: 'const x = 42;' },
          roomNumber,
        });
      }

      // Periodically request fresh user rosters
      const randomUser = students[Math.floor(Math.random() * students.length)];
      randomUser.emit('get-room-users', { roomNumber });
    });

    // B. Simulate OneShare / MultiShare Actions
    if (oneShareClients.length >= 2) {
      if (ENABLE_MULTISHARE && NUM_MULTISHARE_SESSIONS > 0) {
        // MultiShare scenario
        const sender = oneShareClients[0];
        const receivers = oneShareClients.slice(1, 1 + NUM_MULTISHARE_SESSIONS);

        const code = Math.floor(1000 + Math.random() * 9000).toString();
        log(`[OneShare] Sender ${sender.id} creating MultiShare session code: ${code}...`, colors.cyan);

        sender.emit('oneshare-create', {
          code,
          multiShare: true,
          files: [{ fileName: 'multishare-bundle.zip', fileSize: 500000 }],
        });

        // Receivers join after a tiny offset
        receivers.forEach((recv, idx) => {
          setTimeout(() => {
            log(`[OneShare] Receiver ${recv.id} joining MultiShare session code: ${code}...`, colors.cyan);
            recv.emit('oneshare-join', { code });
          }, 100 * (idx + 1));
        });

        // Clean up MultiShare session after 1.5s
        setTimeout(() => {
          sender.emit('oneshare-complete', { code });
        }, 1500);
      } else {
        // Standard OneShare scenario
        const sender = oneShareClients[Math.floor(Math.random() * oneShareClients.length)];
        let receiver = oneShareClients[Math.floor(Math.random() * oneShareClients.length)];
        while (receiver.id === sender.id) {
          receiver = oneShareClients[(Math.floor(Math.random() * oneShareClients.length) + 1) % oneShareClients.length];
        }

        const code = Math.floor(1000 + Math.random() * 9000).toString();
        log(`[OneShare] Sender ${sender.id} creating session code: ${code}...`, colors.cyan);

        sender.emit('oneshare-create', {
          code,
          multiShare: false,
          files: [{ fileName: 'oneshare-photo.jpg', fileSize: 250000 }],
        });

        setTimeout(() => {
          log(`[OneShare] Receiver ${receiver.id} joining session code: ${code}...`, colors.cyan);
          receiver.emit('oneshare-join', { code });
        }, 150);

        setTimeout(() => {
          sender.emit('oneshare-complete', { code });
        }, 1200);
      }
    }
  }, ACTION_INTERVAL_MS);

  // Wait for test duration to complete
  await new Promise(resolve => setTimeout(resolve, TEST_DURATION_MS));
  clearInterval(intervalId);

  // Disconnect all clients
  log('Disconnecting all active clients...', colors.yellow);
  activeClients.forEach(c => c.disconnect());

  log(`Load Test Completed for ${name}.\n`, colors.green + colors.bright);
}

// ============================================================================
// MAIN RUNNER ENTRYPOINT
// ============================================================================
async function main() {
  console.clear();
  console.log(`${colors.bright}${colors.magenta}==================================================`);
  console.log(`         COSMOSHARE SIGNALING LOAD TESTER`);
  console.log(`==================================================${colors.reset}\n`);

  try {
    if (TEST_HUGGING_FACE) {
      await runLoadTest('Hugging Face Space (Socket.IO)', HF_URL, true, HF_TOKEN);
    }
    if (TEST_CLOUDFLARE) {
      await runLoadTest('Cloudflare Workers (Raw WS)', CF_URL, false, '');
    }

    // Print Consolidated Report
    console.log(`${colors.bright}${colors.green}==================================================`);
    console.log(`             LOAD TEST SUMMARY REPORT`);
    console.log(`==================================================${colors.reset}`);
    console.log(`Connections Attempted : ${stats.connectionsAttempted}`);
    console.log(`Connections Successful: ${colors.green}${stats.connectionsSuccessful}${colors.reset}`);
    console.log(`Connections Failed    : ${stats.connectionsFailed > 0 ? colors.red : colors.green}${stats.connectionsFailed}${colors.reset}`);
    console.log(`Signaling Msg Sent    : ${stats.messagesSent}`);
    console.log(`Signaling Msg Received: ${stats.messagesReceived}`);
    console.log(`Errors Recorded       : ${stats.errorsCount > 0 ? colors.red : colors.green}${stats.errorsCount}${colors.reset}`);

    if (stats.latencies.length > 0) {
      const avgLatency = (stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length).toFixed(2);
      const minLatency = Math.min(...stats.latencies);
      const maxLatency = Math.max(...stats.latencies);
      console.log(`Avg Relay Latency     : ${colors.cyan}${avgLatency} ms${colors.reset}`);
      console.log(`Min Relay Latency     : ${colors.cyan}${minLatency} ms${colors.reset}`);
      console.log(`Max Relay Latency     : ${colors.cyan}${maxLatency} ms${colors.reset}`);
    } else {
      console.log(`Relay Latency         : N/A (no relay events registered)`);
    }
    console.log(`${colors.bright}${colors.green}==================================================${colors.reset}\n`);

  } catch (err) {
    console.error(`${colors.red}Load test script encountered an unexpected crash:${colors.reset}`, err);
    process.exit(1);
  }
}

main();
