// ws-server.js
// Usage:
// 1) npm init -y
// 2) npm install ws
// 3) AUTH_TOKEN=secret-token node ws-server.js

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'secret-token';
const LOG_FILE = path.join(__dirname, 'data.log');
const CSV_DIR = path.join(__dirname, 'csv');

// ensure csv dir exists
try { fs.mkdirSync(CSV_DIR, { recursive: true }); } catch (e) { /* ignore */ }

function appendLog(obj) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(obj) + '\n', { encoding: 'utf8' });
  } catch (e) {
    console.error('Failed to append log:', e);
  }
}

// map tokenId -> writeStream
const streams = new Map();

function safeFilename(name) {
  // allow alnum, dash, underscore; replace others with _
  return name.replace(/[^a-zA-Z0-9-_]/g, '_');
}

function extractTokenIdFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const u = new URL(rawUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    // try to find segment after "token"
    const tokenIdx = parts.findIndex(p => p.toLowerCase() === 'token');
    if (tokenIdx >= 0 && parts.length > tokenIdx + 1) return parts[tokenIdx + 1];
    // otherwise return last segment
    if (parts.length) return parts[parts.length - 1];
    // fallback: use hostname
    return u.hostname;
  } catch (e) {
    // fallback: try to parse as plain path
    const parts = rawUrl.split('/').filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
    return null;
  }
}

function getCsvStreamForToken(tokenId) {
  if (!tokenId) tokenId = 'unknown';
  const safe = safeFilename(tokenId);
  if (streams.has(safe)) return streams.get(safe);

  const csvPath = path.join(CSV_DIR, `${safe}.csv`);
  const exists = fs.existsSync(csvPath);

  // open append stream
  const ws = fs.createWriteStream(csvPath, { flags: 'a', encoding: 'utf8' });
  // if file just created, write header
  if (!exists) {
    const header = 'receivedAt,mcap,holders,avgCostMc,avgCostMcPct,top10Percent,top100Percent\n';
    ws.write(header);
  }

  streams.set(safe, { stream: ws, path: csvPath });
  return streams.get(safe);
}

function numericToCsvCell(v) {
  // Only numbers allowed. If missing/NaN -> leave empty
  if (v === null || v === undefined) return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  // use plain number representation (no thousands separators)
  return String(n);
}

function writeCsvRow(parsed) {
  // ensure we have server receive time
  const receivedAt = parsed._receivedAt || new Date().toISOString();

  const tokenId = extractTokenIdFromUrl(parsed.url || '');
  const holder = getCsvStreamForToken(tokenId);

  const mcap = numericToCsvCell(parsed.mcap);
  const holders = numericToCsvCell(parsed.holders);
  const avgCostMc = numericToCsvCell(parsed.avgCostMc);
  const avgCostMcPct = numericToCsvCell(parsed.avgCostMcPct);
  const top10 = numericToCsvCell(parsed.top10Percent || parsed.top10Pct || parsed.top10); // fallback keys
  const top100 = numericToCsvCell(parsed.top100Percent || parsed.top100Pct || parsed.top100);

  const row = `${receivedAt},${mcap},${holders},${avgCostMc},${avgCostMcPct},${top10},${top100}\n`;

  try {
    holder.stream.write(row);
  } catch (e) {
    console.error('Failed to write CSV row for', tokenId, e);
  }
}

// cleanly close streams on exit
function closeAllStreams() {
  streams.forEach(({ stream, path: p }) => {
    try {
      stream.end();
    } catch (e) {}
  });
}

process.on('exit', () => { closeAllStreams(); });
process.on('SIGINT', () => { closeAllStreams(); process.exit(0); });
process.on('SIGTERM', () => { closeAllStreams(); process.exit(0); });

const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`WS server listening on ws://0.0.0.0:${PORT}`);
  console.log(`AUTH_TOKEN=${AUTH_TOKEN} (change in env for production)`);
  console.log(`Writing received messages to ${LOG_FILE}`);
  console.log(`CSV files in ${CSV_DIR}`);
});

wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (token !== AUTH_TOKEN) {
      console.warn('Connection rejected: invalid token from', req.socket.remoteAddress);
      ws.close(1008, 'Invalid token');
      return;
    }

    console.log('Client connected:', req.socket.remoteAddress);

    ws.on('message', (data) => {
      let parsed = null;
      try {
        parsed = JSON.parse(data.toString());
      } catch (e) {
        console.warn('Received non-JSON message:', data.toString());
        return;
      }

      // Enrich with server receive time (ISO)
      parsed._receivedAt = new Date().toISOString();

      // Append to JSON log (for debugging / full records)
      appendLog(parsed);

      // write CSV row (numbers only)
      try {
        writeCsvRow(parsed);
      } catch (e) {
        console.error('Failed writing CSV row:', e);
      }

      // optional short console output (brief)
      const short = {
        time: parsed._receivedAt,
        url: parsed.url,
        mcap: parsed.mcap,
        holders: parsed.holders,
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
      console.log('Client disconnected:', req.socket.remoteAddress, 'code=', code, 'reason=', reason && reason.toString && reason.toString());
    });

    ws.on('error', (err) => {
      console.warn('WS error:', err && err.message);
    });

  } catch (err) {
    console.error('Connection handling error:', err);
    try { ws.close(1011, 'server error'); } catch (e) {}
  }
});

wss.on('error', (err) => {
  console.error('Server error:', err);
});
