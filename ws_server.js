// ws-server.js
// Usage:
// 1) npm install express ws cors
// 2) AUTH_TOKEN=secret-token node ws-server.js
// On Windows (cmd): set AUTH_TOKEN=secret-token&& node ws-server.js
//
// Server serves:
//  - static files from project root (open http://127.0.0.1:8080/dashboard.html)
//  - CSV files from ./csv/ via /csv/<name>.csv
//  - /csv/list returns JSON array of csv filenames
//  - WebSocket endpoint on the same http server (auth by ?token=...)
//  - Received messages are appended to data.log and to csv/<tokenId>.csv (numeric fields only)

const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'secret-token';
const LOG_FILE = path.join(__dirname, 'data.log');
const CSV_DIR = path.join(__dirname, 'csv');
if (!fs.existsSync(CSV_DIR)) fs.mkdirSync(CSV_DIR, { recursive: true });

function appendLog(obj) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(obj) + '\n', { encoding: 'utf8' });
  } catch (e) {
    console.error('Failed to append log:', e);
  }
}

function tokenIdFromUrl(urlStr) {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex(p => p.toLowerCase() === 'token');
    if (idx >= 0 && parts.length > idx + 1) return parts[idx + 1];
    if (parts.length) return parts[parts.length - 1];
    return u.hostname;
  } catch (e) {
    const parts = urlStr.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : urlStr;
  }
}

// ensure csv header exists for token
function ensureCsvHeader(tokenId) {
  const file = path.join(CSV_DIR, `${tokenId}.csv`);
  if (!fs.existsSync(file)) {
    const header = 'time,mcap,holders,avgCostMcPct,top10Percent,top100Percent\n';
    fs.writeFileSync(file, header, { encoding: 'utf8' });
  }
  return file;
}

function appendToCsv(tokenId, rowObj) {
  try {
    const file = ensureCsvHeader(tokenId);
    // Only numbers + time column (ignore raw strings)
    const time = rowObj._receivedAt || rowObj.time || new Date().toISOString();
    const mcap = (typeof rowObj.mcap === 'number') ? rowObj.mcap : (Number(rowObj.mcap) || '');
    const holders = (typeof rowObj.holders === 'number') ? rowObj.holders : (Number(rowObj.holders) || '');
    const avgCostMcPct = rowObj.avgCostMcPct !== undefined ? Number(rowObj.avgCostMcPct) : (rowObj.avgCostPct !== undefined ? Number(rowObj.avgCostPct) : '');
    const top10Percent = rowObj.top10Percent !== undefined ? Number(rowObj.top10Percent) : (rowObj.top10Pct !== undefined ? Number(rowObj.top10Pct) : '');
    const top100Percent = rowObj.top100Percent !== undefined ? Number(rowObj.top100Percent) : (rowObj.top100Pct !== undefined ? Number(rowObj.top100Pct) : '');
    const line = `${time},${mcap},${holders},${avgCostMcPct},${top10Percent},${top100Percent}\n`;
    fs.appendFileSync(file, line, { encoding: 'utf8' });
  } catch (e) {
    console.error('Failed to append CSV:', e);
  }
}

// --- Express + static + csv endpoints ---
const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname))); // serve dashboard.html and other assets in project root

// list csv files
app.get('/csv/list', (req, res) => {
  try {
    const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// serve csv files directly via /csv/:name
app.get('/csv/:name', (req, res) => {
  const name = req.params.name;
  // sanitize
  if (!name || name.includes('..')) return res.status(400).send('bad name');
  const file = path.join(CSV_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).send('not found');
  res.sendFile(file);
});

// create underlying http server so we can attach ws to it
const server = http.createServer(app);

// --- WebSocket server attached to HTTP server ---
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  if (token !== AUTH_TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  try {
    console.log('Client connected:', req.socket.remoteAddress);
    ws.on('message', (data) => {
      let parsed = null;
      try {
        parsed = JSON.parse(data.toString());
      } catch (e) {
        // maybe it's wrapped as {type:'broadcast', payload:...}
        try {
          const t = JSON.parse(String(data));
          if (t && t.type === 'broadcast' && t.payload) parsed = t.payload;
        } catch (e2) {}
      }
      if (!parsed) {
        console.warn('Received non-json:', data.toString().slice(0,200));
        return;
      }
      parsed._receivedAt = new Date().toISOString();
      appendLog(parsed);

      // append numeric CSV by tokenId
      const tokenId = tokenIdFromUrl(parsed.url) || 'unknown';
      appendToCsv(tokenId, parsed);

      // console brief
      const short = {
        time: parsed.time || parsed._receivedAt,
        url: parsed.url,
        mcap: parsed.mcap,
        holders: parsed.holders
      };
      console.log('recv:', JSON.stringify(short));

      // broadcast to other clients (optional)
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          try { client.send(JSON.stringify({ type: 'broadcast', payload: parsed })); } catch (e) {}
        }
      });
    });

    ws.on('close', (code, reason) => {
      console.log('Client disconnected:', req.socket.remoteAddress, 'code=', code);
    });
    ws.on('error', (err) => {
      console.warn('WS error:', err && err.message);
    });
  } catch (err) {
    console.error('Connection handling error:', err);
    try { ws.close(1011, 'server error'); } catch (e) {}
  }
});

server.listen(PORT, () => {
  console.log(`HTTP+WS server listening on http://0.0.0.0:${PORT}`);
  console.log(`AUTH_TOKEN=${AUTH_TOKEN}`);
  console.log(`Writing received messages to ${LOG_FILE}`);
  console.log(`CSV files in ${CSV_DIR}`);
});
