(() => {
  // === Настройки ===
  const WS_HOST = '127.0.0.1';
  const WS_PORT = 8080;
  const AUTH_TOKEN = 'secret-token'; // Поменяй на тот же, что и на сервере
  const WS_URL = `ws://${WS_HOST}:${WS_PORT}/?token=${encodeURIComponent(AUTH_TOKEN)}`;
  const POLL_INTERVAL_MS = 1000;

  if (window.__wsLoggerRunning) {
    console.warn('WS logger already running. Call window.stopWSLogger() to stop first.');
    return;
  }
  window.__wsLoggerRunning = true;

  // ------------------ вспомогательные парсеры ------------------
  function parseLocaleNumberWithSuffix(raw) {
    if (!raw || typeof raw !== 'string') return NaN;
    const s = raw.trim();
    const match = s.match(/([+\-]?[0-9\s.,]+)\s*([KMBTkmbt])?/);
    if (!match) return NaN;
    let numStr = match[1].replace(/\s+/g, '');
    const suffix = match[2] ? match[2].toUpperCase() : null;
    const hasDot = numStr.indexOf('.') !== -1;
    const hasComma = numStr.indexOf(',') !== -1;
    if (hasDot && hasComma) {
      const lastDot = numStr.lastIndexOf('.');
      const lastComma = numStr.lastIndexOf(',');
      if (lastDot > lastComma) numStr = numStr.replace(/,/g, '');
      else numStr = numStr.replace(/\./g, '').replace(/,/g, '.');
    } else if (hasComma && !hasDot) {
      const parts = numStr.split(',');
      if (parts.length > 2) numStr = numStr.replace(/,/g, '');
      else {
        const frac = parts[1];
        if (frac && frac.length === 3) numStr = numStr.replace(/,/g, '');
        else numStr = parts[0] + '.' + (parts[1] || '');
      }
    } else if (hasDot && !hasComma) {
      const parts = numStr.split('.');
      if (parts.length === 2 && parts[1].length === 3 && !suffix) numStr = numStr.replace(/\./g, '');
    }
    numStr = numStr.replace(/[^0-9.\-]/g, '');
    if (numStr === '' || numStr === '.' || numStr === '-') return NaN;
    const parsed = parseFloat(numStr);
    if (isNaN(parsed)) return NaN;
    let mul = 1;
    if (suffix === 'K') mul = 1e3;
    else if (suffix === 'M') mul = 1e6;
    else if (suffix === 'B') mul = 1e9;
    else if (suffix === 'T') mul = 1e12;
    return parsed * mul;
  }

  function parsePercentage(raw) {
    if (!raw || typeof raw !== 'string') return NaN;
    const m = raw.match(/([+\-]?\d+[.,]?\d*)\s*%/);
    if (!m) return NaN;
    return parseFloat(m[1].replace(',', '.'));
  }

  // ------------------ поиск value по label (из твоего рабочего кода) ------------------
  function findValueByLabelText(labelText) {
    if (!labelText) return null;
    const labelCandidates = Array.from(document.querySelectorAll('div,span')).filter(el => {
      const t = (el.textContent || '').trim();
      return t === labelText || t === labelText.trim();
    });

    let nodes = labelCandidates;
    if (nodes.length === 0) {
      nodes = Array.from(document.querySelectorAll('div,span')).filter(el => {
        const t = (el.textContent || '').trim();
        return t && t.includes(labelText.trim());
      });
    }

    for (const lbl of nodes) {
      let ancestor = lbl.parentElement;
      for (let depth = 0; depth < 3 && ancestor; depth++, ancestor = ancestor.parentElement) {
        const candidates = Array.from(ancestor.querySelectorAll('*')).filter(c => {
          if (c === lbl) return false;
          const text = (c.textContent || '').trim();
          if (!text) return false;
          return /[0-9]/.test(text) || /[KMBTkmbt\$€£]/.test(text);
        });
        if (candidates.length === 0) continue;
        const following = candidates.find(c => (lbl.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING));
        if (following) return following;
        return candidates[0];
      }
      const combinedText = (lbl.textContent || '').trim();
      if (/\d/.test(combinedText)) return lbl;
    }

    const containers = Array.from(document.querySelectorAll('div,span')).filter(el => (el.textContent || '').includes(labelText.trim()));
    for (const p of containers) {
      const found = Array.from(p.querySelectorAll('*')).find(c => {
        const t = (c.textContent || '').trim();
        return t && /[0-9]/.test(t) && !t.includes(labelText.trim());
      });
      if (found) return found;
      if (/\d/.test((p.textContent || ''))) return p;
    }
    return null;
  }

  // ------------------ извлечение Avg Cost MC (robust) ------------------
  function extractAvgCost() {
    // попробуем сначала найти элемент с классом info-item-title/ info-item-value рядом
    const labels = Array.from(document.querySelectorAll('.info-item-title')).filter(el => (el.textContent||'').trim().includes('Avg Cost MC'));
    for (const lbl of labels) {
      const parent = lbl.closest('div');
      if (!parent) continue;
      // ищем .info-item-value в родителе
      const val = parent.querySelector('.info-item-value');
      if (val && /\d/.test((val.textContent||''))) {
        const raw = (val.textContent||'').trim();
        const num = isNaN(parseLocaleNumberWithSuffix(raw)) ? null : parseLocaleNumberWithSuffix(raw);
        const pct = (val.textContent||'').match(/\d+[.,]?\d*\s*%/) ? parsePercentage((val.textContent||'').match(/\d+[.,]?\d*\s*%/)[0]) : null;
        return { raw: raw, value: num, pct: pct };
      }
      // fallback: искать numeric descendant near lbl
      const candidate = Array.from(parent.querySelectorAll('*')).find(c => /\d/.test((c.textContent||'')) && !c.querySelector('canvas'));
      if (candidate) {
        const raw = (candidate.textContent||'').trim();
        const num = isNaN(parseLocaleNumberWithSuffix(raw)) ? null : parseLocaleNumberWithSuffix(raw);
        const pct = (candidate.textContent||'').match(/\d+[.,]?\d*\s*%/) ? parsePercentage((candidate.textContent||'').match(/\d+[.,]?\d*\s*%/)[0]) : null;
        return { raw: raw, value: num, pct: pct };
      }
    }

    // если не нашли по классу — общий поиск по лейблу
    const el = findValueByLabelText('Avg Cost MC');
    if (!el) return { raw: null, value: null, pct: null };
    const txt = (el.textContent||'').trim();
    const numMatch = txt.match(/([+\-]?[0-9\s.,]+(?:[KMBTkmbt])?)/);
    const rawNum = numMatch ? numMatch[1].trim() : null;
    const numVal = rawNum ? parseLocaleNumberWithSuffix(rawNum) : NaN;
    const pctMatch = txt.match(/\(?([+\-]?\d+[.,]?\d*)\s*%\)?/);
    const pct = pctMatch ? parseFloat(pctMatch[1].replace(',', '.')) : null;
    return { raw: txt, value: isNaN(numVal) ? null : numVal, pct: isNaN(pct) ? null : pct };
  }

  // ------------------ извлечение Top 10 (точно по твоему HTML) ------------------
  function extractTop10() {
    // 1) ищем span.info-item-title с текстом "Top 10"
    const title = Array.from(document.querySelectorAll('span.info-item-title')).find(s => (s.textContent||'').trim() === 'Top 10' || (s.textContent||'').trim().includes('Top 10'));
    if (title) {
      // parent контейнер, где должен быть .info-item-value
      const container = title.closest('div');
      if (container) {
        // ищем элемент с классом info-item-value внутри контейнера
        const val = container.querySelector('.info-item-value');
        if (val && /\d/.test((val.textContent||''))) {
          const raw = (val.textContent||'').trim();
          const pct = parsePercentage(raw);
          return { raw, pct: isNaN(pct) ? null : pct, debug: 'by-info-item-class' };
        }
        // иногда structure чуть отличная — проверим nextElementSibling of container
        const next = container.nextElementSibling;
        if (next) {
          const fv = next.querySelector && next.querySelector('.info-item-value') ? next.querySelector('.info-item-value') : next;
          if (fv && /\d/.test((fv.textContent||''))) {
            const raw = (fv.textContent||'').trim();
            const pct = parsePercentage(raw);
            return { raw, pct: isNaN(pct) ? null : pct, debug: 'by-container-sibling' };
          }
        }
      }
    }

    // 2) fallback: используем общий поиск по лейблу (как раньше)
    const el = findValueByLabelText('Top 10');
    if (!el) return { raw: null, pct: null, debug: 'not-found' };
    const txt = (el.textContent || '').trim();
    const m = txt.match(/\d+[.,]?\d*\s*%/);
    if (!m) return { raw: null, pct: null, debug: 'no-percent-in-found' };
    return { raw: m[0], pct: parsePercentage(m[0]), debug: 'fallback' };
  }

  // ------------------ Новая финальная функция извлечения TOP100 (Owned) ------------------
  function isInsideAvgCost(el) {
    if (!el) return false;
    let p = el;
    while (p) {
      const txt = (p.textContent || '').trim();
      if (/Avg\s*Cost\s*MC/i.test(txt)) return true;
      p = p.parentElement;
    }
    return false;
  }

  function extractTop100Final() {
    // 1) Найти элемент 'TOP100' (case-insensitive)
    const title = Array.from(document.querySelectorAll('div,span')).find(e => {
      const t = (e.textContent || '').trim();
      return t && (t.toUpperCase() === 'TOP100' || t.toUpperCase().includes('TOP100'));
    });
    if (!title) return { raw: null, pct: null, debug: 'no-title' };

    // Попробуем найти в пределах ближайшего контейнера, сканируя соседние элементы
    let container = title.parentElement;
    for (let up = 0; up < 5 && container; up++, container = container.parentElement) {
      const children = Array.from(container.children || []);
      const idx = children.indexOf(title);
      if (idx >= 0) {
        for (let i = idx + 1; i < children.length; i++) {
          const sibling = children[i];
          if (!sibling || (sibling.querySelector && sibling.querySelector('canvas'))) continue;
          const text = (sibling.textContent || '').trim();
          if (/^Owned\b/i.test(text) || text.startsWith('Owned:') || /\bOwned\b/i.test(text)) {
            const pctInside = (sibling.textContent || '').match(/\d+[.,]?\d*\s*%/);
            if (pctInside && !isInsideAvgCost(sibling)) return { raw: pctInside[0], pct: parsePercentage(pctInside[0]), debug: 'owned-sibling' };
            const inside = Array.from(sibling.querySelectorAll('*')).map(n => (n.textContent||'').trim()).find(t => /\d+[.,]?\d*\s*%/.test(t));
            if (inside && !/Avg\s*Cost\s*MC/i.test(inside)) return { raw: inside.match(/\d+[.,]?\d*\s*%/)[0], pct: parsePercentage(inside.match(/\d+[.,]?\d*\s*%/)[0]), debug: 'owned-sibling-desc' };
          }
          const pctMatch = (sibling.textContent || '').match(/\d+[.,]?\d*\s*%/);
          if (pctMatch && !isInsideAvgCost(sibling)) {
            return { raw: pctMatch[0], pct: parsePercentage(pctMatch[0]), debug: 'sibling-percent' };
          }
          const inner = Array.from(sibling.querySelectorAll('*')).find(n => {
            const t = (n.textContent||'').trim();
            return t && /\d+[.,]?\d*\s*%/.test(t) && !isInsideAvgCost(n) && !(n.querySelector && n.querySelector('canvas'));
          });
          if (inner) {
            const m = (inner.textContent||'').match(/\d+[.,]?\d*\s*%/);
            if (m) return { raw: m[0], pct: parsePercentage(m[0]), debug: 'sibling-inner' };
          }
        }
      }

      // search inside container
      const candidates = Array.from(container.querySelectorAll('*')).filter(n => {
        const t = (n.textContent || '').trim();
        return t && /\d+[.,]?\d*\s*%/.test(t) && !isInsideAvgCost(n) && !(n.querySelector && n.querySelector('canvas'));
      });
      if (candidates.length) {
        const priority = candidates.find(c => /(info-item-value|text-text-100|font-medium|font-semibold|text-base)/i.test(c.className || ''));
        const chosen = priority || candidates[0];
        const mm = (chosen.textContent||'').match(/\d+[.,]?\d*\s*%/);
        if (mm) return { raw: mm[0], pct: parsePercentage(mm[0]), debug: 'container-desc' };
      }
    }

    // global owned fallback
    const ownedGlobal = Array.from(document.querySelectorAll('div,span')).find(e => {
      const t = (e.textContent||'').trim();
      return t && (/^Owned\b/i.test(t) || t.startsWith('Owned:'));
    });
    if (ownedGlobal) {
      if (ownedGlobal.nextElementSibling && (ownedGlobal.nextElementSibling.textContent||'').match(/\d+[.,]?\d*\s*%/)) {
        const raw = (ownedGlobal.nextElementSibling.textContent||'').trim().match(/\d+[.,]?\d*\s*%/)[0];
        if (!isInsideAvgCost(ownedGlobal.nextElementSibling)) return { raw, pct: parsePercentage(raw), debug: 'owned-global-next' };
      }
      const inside = Array.from((ownedGlobal.parentElement||document).querySelectorAll('*')).map(n => (n.textContent||'').trim()).find(t => /\d+[.,]?\d*\s*%/.test(t) && !/Avg\s*Cost\s*MC/i.test(t));
      if (inside) return { raw: inside.match(/\d+[.,]?\d*\s*%/)[0], pct: parsePercentage(inside.match(/\d+[.,]?\d*\s*%/)[0]), debug: 'owned-global-inside' };
    }

    // largest percent fallback excluding avg cost
    const allPct = Array.from(document.querySelectorAll('div,span')).map(n => (n.textContent||'').trim()).filter(t => /\d+[.,]?\d*\s*%/.test(t) && !/Avg\s*Cost\s*MC/i.test(t));
    if (allPct.length) {
      let best = null, bestVal = -Infinity;
      for (const t of allPct) {
        const mm = t.match(/(\d+[.,]?\d*)\s*%/);
        if (!mm) continue;
        const v = parseFloat(mm[1].replace(',', '.'));
        if (!isNaN(v) && v > bestVal) { bestVal = v; best = t.match(/\d+[.,]?\d*\s*%/)[0]; }
      }
      if (best) return { raw: best, pct: parsePercentage(best), debug: 'largest-on-page' };
    }

    return { raw: null, pct: null, debug: 'not-found' };
  }

  // ------------------ WebSocket client ------------------
  let ws = null;
  let reconnectDelay = 1000;
  const MAX_RECONNECT = 30000;
  window.__wsQueue = window.__wsQueue || [];

  function connectWS() {
    try {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        console.log('WS connected to', WS_URL);
        reconnectDelay = 1000;
        if (window.__wsQueue.length) {
          while (window.__wsQueue.length) {
            const item = window.__wsQueue.shift();
            try { ws.send(JSON.stringify(item)); } catch (e) { window.__wsQueue.unshift(item); break; }
          }
        }
      };
      ws.onmessage = (ev) => { /* optional server replies */ };
      ws.onclose = (e) => { console.warn('WS closed', e && e.code, e && e.reason); scheduleReconnect(); };
      ws.onerror = (err) => { console.warn('WS error', err && err.message); };
    } catch (e) {
      console.error('WS connect failed', e);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (!window.__wsLoggerRunning) return;
    const d = reconnectDelay;
    setTimeout(() => {
      reconnectDelay = Math.min(MAX_RECONNECT, Math.floor(reconnectDelay * 1.8));
      connectWS();
    }, d);
  }

  function sendPayload(payload) {
    try {
      const json = JSON.stringify(payload);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(json);
      else window.__wsQueue.push(payload);
    } catch (e) {
      window.__wsQueue.push(payload);
    }
  }

  // ------------------ polling + сбор данных ------------------
  let intervalId = null;
  function findValueSimple(label) {
    const el = findValueByLabelText(label);
    return el ? (el.textContent || '').trim() : null;
  }

  function fetchAndSend() {
    const timeISO = new Date().toISOString();

    const mcapRaw = findValueSimple('Market cap');
    const holdersRaw = findValueSimple('Holders');

    const mcapNum = mcapRaw ? (isNaN(parseLocaleNumberWithSuffix(mcapRaw)) ? null : parseLocaleNumberWithSuffix(mcapRaw)) : null;
    const holdersNum = holdersRaw ? (isNaN(parseLocaleNumberWithSuffix(holdersRaw)) ? null : Math.round(parseLocaleNumberWithSuffix(holdersRaw))) : null;

    const avg = extractAvgCost();
    const avgRaw = avg.raw;
    const avgVal = avg.value;
    const avgPct = avg.pct;

    const top = extractTop10();
    const top10Raw = top.raw;
    const top10Pct = top.pct;

    const top100 = extractTop100Final();
    const top100Raw = top100.raw;
    const top100Pct = top100.pct;

    console.log(
      `[${new Date().toLocaleTimeString()}] MarketCap: ${mcapNum === null ? 'NaN' : mcapNum}` +
      ` | Holders: ${holdersNum === null ? 'NaN' : holdersNum}` +
      ` | AvgCostMC: ${avgVal === null ? 'NaN' : avgVal}` +
      ` | AvgCostPct: ${avgPct === null ? 'NaN' : avgPct}` +
      ` | Top10Pct: ${top10Pct === null ? 'NaN' : top10Pct}` +
      ` | Top100Pct: ${top100Pct === null ? 'NaN' : top100Pct}`
    );

    const payload = {
      time: timeISO,
      url: location.href,
      mcapRaw: mcapRaw,
      mcap: mcapNum,
      holdersRaw: holdersRaw,
      holders: holdersNum,
      avgCostMcRaw: avgRaw,
      avgCostMc: avgVal,
      avgCostMcPct: avgPct,
      top10Raw: top10Raw,
      top10Percent: top10Pct,
      top100Raw: top100Raw,
      top100Percent: top100Pct,
      source: 'browser-console'
    };

    window.__mcapHistory = window.__mcapHistory || [];
    window.__mcapHistory.push(payload);
    if (window.__mcapHistory.length > 5000) window.__mcapHistory.shift();

    sendPayload(payload);
  }

  // старт
  connectWS();
  fetchAndSend();
  intervalId = setInterval(fetchAndSend, POLL_INTERVAL_MS);

  // остановка
  window.stopWSLogger = function () {
    console.log('Stopping WS logger...');
    window.__wsLoggerRunning = false;
    if (intervalId) clearInterval(intervalId);
    if (ws) try { ws.close(1000, 'client stop'); } catch (e) {}
    console.log('Stopped. Queue length:', window.__wsQueue.length, 'History length:', (window.__mcapHistory||[]).length);
  };

  window.addEventListener('beforeunload', () => {
    try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, 'unload'); } catch (e) {}
  });

  console.log('WS logger started (improved Avg Cost MC + Top10 + TOP100). Stop with window.stopWSLogger(). Queue: window.__wsQueue, History: window.__mcapHistory');
})();
