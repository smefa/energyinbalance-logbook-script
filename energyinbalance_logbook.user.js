// ==UserScript==
// @name         EnergyInBalance – Logbook Viewer
// @namespace    https://energyinbalance.se/
// @version      1.6
// @description  Shows your battery system logbook from EnergyInBalance in a floating panel. Just install and go — no configuration needed.
// @author       You
// @match        https://energyinbalance.se/*
// @connect      api.checkwatt.se
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/smefa/energyinbalance-logbook-script/main/energyinbalance_logbook.user.js
// @downloadURL  https://raw.githubusercontent.com/smefa/energyinbalance-logbook-script/main/energyinbalance_logbook.user.js
// @run-at       document-idle
// ==/UserScript==

// ═══════════════════════════════════════════════════════════════════
//  HOW TO INSTALL
//  1. Install the Tampermonkey browser extension
//  2. In Vivaldi/Chrome: go to the extension settings and enable
//     "Allow user scripts" for Tampermonkey
//  2b. In firefox go to about:config in the address bar
//      Search for extensions.userScripts.enabled
//      Set it to true
//  3. Open Tampermonkey → Create new script
//  4. Paste this entire file and save (Ctrl+S)
//  5. Go to https://energyinbalance.se/dashboard and log in
//  6. Click the green 📓 Logbook button in the bottom-right corner
//
//  No cookies, tokens, or configuration needed — the script reads
//  your login session automatically.
// ═══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const PREVIEW_COUNT = 3;
  let panelVisible = false;
  let commentsVisible = false;

  // ── Get JWT from cookie ──────────────────────────────────────────────────
  function getToken() {
    try {
      const match = document.cookie.match(/user=([^;]+)/);
      if (!match) return null;
      const user = JSON.parse(decodeURIComponent(match[1]));
      return user.JwtToken || null;
    } catch (e) {
      return null;
    }
  }

  // ── Fetch from API ───────────────────────────────────────────────────────
  function fetchData(onSuccess, onError) {
    const token = getToken();
    if (!token) {
      onError('Not logged in — please log in to EnergyInBalance first.');
      return;
    }
    GM_xmlhttpRequest({
      method: 'GET',
      url: 'https://api.checkwatt.se/controlpanel/CustomerDetail',
      headers: {
        'Authorization': 'Bearer ' + token,
        'accept': 'application/json, text/plain, */*',
        'origin': 'https://energyinbalance.se',
        'referer': 'https://energyinbalance.se/',
        'wslog-os': navigator.userAgent,
        'wslog-platform': 'EIB'
      },
      onload: function (response) {
        try {
          const data = JSON.parse(response.responseText);
          onSuccess(data);
        } catch (e) {
          onError('Could not parse response from server.');
        }
      },
      onerror: function () {
        onError('Network error — could not reach api.checkwatt.se.');
      }
    });
  }

  // ── Entry styling ────────────────────────────────────────────────────────
  function getEntryStyle(line) {
    if (line.includes('FCR-D ACTIVATED') && !line.includes('FAIL') && !line.includes('AUTO'))
      return { bg: '#e8f5e9', border: '#66bb6a', icon: '✅' };
    if (line.includes('FCR-D AUTO-ACTIVATED'))
      return { bg: '#e3f2fd', border: '#42a5f5', icon: '🔄' };
    if (line.includes('FCR-D DEACTIVATE'))
      return { bg: '#fff3e0', border: '#ffa726', icon: '⏸️' };
    if (line.includes('FCR-D FAIL'))
      return { bg: '#ffebee', border: '#ef5350', icon: '❌' };
    if (line.includes('LILLTEST'))
      return { bg: '#f3e5f5', border: '#ab47bc', icon: '🧪' };
    if (line.includes('BATTERY_REGISTRATION'))
      return { bg: '#e0f7fa', border: '#26c6da', icon: '🔋' };
    return { bg: '#f9fafb', border: '#e0e0e0', icon: '📝' };
  }

  function parseTimestamp(line) {
    const match = line.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?)/);
    return match ? match[1] : null;
  }

  // ── Build a single log entry card ────────────────────────────────────────
  function buildCard(line) {
    const style = getEntryStyle(line);
    const ts = parseTimestamp(line);

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: style.bg,
      border: '1px solid ' + style.border,
      borderRadius: '6px',
      padding: '7px 10px',
      marginBottom: '6px',
      display: 'flex',
      gap: '8px',
      alignItems: 'flex-start',
    });

    const icon = document.createElement('span');
    icon.textContent = style.icon;
    Object.assign(icon.style, { flexShrink: '0', fontSize: '14px' });

    const textWrap = document.createElement('div');
    Object.assign(textWrap.style, { flex: '1', minWidth: '0' });

    let displayText = line;
    if (ts) displayText = line.replace(ts, '').replace(/API-BACKEND$/, '').replace(/\s+-\s*$/, '').trim();

    const mainText = document.createElement('div');
    Object.assign(mainText.style, { wordBreak: 'break-word', color: '#222' });

    // Match percentage pattern e.g. 97.6/0.3/98.3 %
    const pctMatch = displayText.match(/([\d]+[.,][\d]+)\/([\d]+[.,][\d]+)\/([\d]+[.,][\d]+)\s*%/);
    // Match kW pattern e.g. (8.0/8.0 kW)
    const kwMatch = displayText.match(/\(([\d]+[.,][\d]+)\/([\d]+[.,][\d]+)\s*kW\)/);

    if (pctMatch || kwMatch) {
      let remaining = displayText;

      // Helper to append text node up to a match, then the annotated span
      function appendAnnotated(text, matchStr, spanText, tooltip) {
        const idx = text.indexOf(matchStr);
        if (idx === -1) return text;
        mainText.appendChild(document.createTextNode(text.substring(0, idx)));
        const span = document.createElement('span');
        span.textContent = spanText + ' ⓘ';
        Object.assign(span.style, {
          borderBottom: '1px dashed #888',
          cursor: 'help',
          color: '#1a6e3c',
          fontWeight: '600',
        });
        span.title = tooltip;
        mainText.appendChild(span);
        return text.substring(idx + matchStr.length);
      }

      if (pctMatch) {
        const pctTooltip = [
          'Assumed interpretation*:',
          pctMatch[1] + '% = FCR-D Up performance (response to low frequency <49.9 Hz)',
          pctMatch[2] + '% = Outside acceptable window / failure rate',
          pctMatch[3] + '% = FCR-D Down performance (response to high frequency >50.1 Hz)',
          '',
          '* Not officially confirmed by CheckWatt/EnergyInBalance.',
          '  Based on FCR-D prequalification rules from Svenska kraftnät.',
        ].join('\n');
        remaining = appendAnnotated(remaining, pctMatch[0], pctMatch[0], pctTooltip);
      }

      if (kwMatch) {
        const kwTooltip = [
          'Assumed interpretation*:',
          kwMatch[1] + ' kW = Contracted/bid capacity for FCR-D',
          kwMatch[2] + ' kW = Actually delivered capacity',
          '',
          '* Not officially confirmed by CheckWatt/EnergyInBalance.',
          '  Based on FCR-D prequalification rules from Svenska kraftnät.',
        ].join('\n');
        remaining = appendAnnotated(remaining, kwMatch[0], kwMatch[0], kwTooltip);
      }

      if (remaining) mainText.appendChild(document.createTextNode(remaining));
    } else {
      mainText.textContent = displayText;
    }

    textWrap.appendChild(mainText);

    if (ts) {
      const tsEl = document.createElement('div');
      tsEl.textContent = ts + (line.includes('API-BACKEND') ? ' · API' : '');
      Object.assign(tsEl.style, { fontSize: '11px', color: '#888', marginTop: '2px' });
      textWrap.appendChild(tsEl);
    }

    card.appendChild(icon);
    card.appendChild(textWrap);
    return card;
  }

  // ── Render logbook with show more ────────────────────────────────────────
  function renderLogbook(container, lines) {
    container.innerHTML = '';

    if (lines.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No logbook entries found.';
      Object.assign(empty.style, { color: '#888', fontStyle: 'italic' });
      container.appendChild(empty);
      return;
    }

    const preview = lines.slice(0, PREVIEW_COUNT);
    const rest = lines.slice(PREVIEW_COUNT);

    preview.forEach(line => container.appendChild(buildCard(line)));

    if (rest.length > 0) {
      const extraWrap = document.createElement('div');
      extraWrap.style.display = 'none';
      rest.forEach(line => extraWrap.appendChild(buildCard(line)));
      container.appendChild(extraWrap);

      const showMore = document.createElement('button');
      showMore.textContent = '▼ Show ' + rest.length + ' more entries';
      Object.assign(showMore.style, {
        width: '100%',
        padding: '8px',
        background: '#f0f0f0',
        border: '1px solid #ccc',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '12px',
        color: '#555',
        marginTop: '2px',
      });
      showMore.onclick = function () {
        extraWrap.style.display = 'block';
        showMore.style.display = 'none';
      };
      container.appendChild(showMore);
    }
  }

  // ── Build comments panel ─────────────────────────────────────────────────
  function buildCommentsPanel(comments) {
    let panel = document.getElementById('eib-comments-panel');
    if (panel) {
      panel.remove();
      commentsVisible = false;
      return;
    }

    commentsVisible = true;
    panel = document.createElement('div');
    panel.id = 'eib-comments-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      bottom: '70px',
      right: '530px',
      zIndex: '999998',
      width: '360px',
      maxHeight: '75vh',
      background: '#fff',
      border: '1px solid #ccc',
      borderRadius: '10px',
      boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'sans-serif',
      fontSize: '13px',
      overflow: 'hidden',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      background: '#2d6a8f',
      color: '#fff',
      padding: '10px 14px',
      fontWeight: 'bold',
      fontSize: '14px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexShrink: '0',
    });
    header.innerHTML = '<span>💬 Technician Comments</span>';

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, { cursor: 'pointer', fontSize: '16px' });
    closeBtn.onclick = function () { panel.remove(); commentsVisible = false; };
    header.appendChild(closeBtn);

    const content = document.createElement('div');
    Object.assign(content.style, {
      overflowY: 'auto',
      padding: '12px',
      flex: '1',
      lineHeight: '1.6',
    });

    const lines = (comments || '').trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) {
      content.textContent = 'No comments found.';
    } else {
      lines.forEach(function (line, i) {
        // Try to extract date at end: "text YYYY-MM-DD Name"
        const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
        const card = document.createElement('div');
        Object.assign(card.style, {
          background: i % 2 === 0 ? '#f0f6ff' : '#fff',
          border: '1px solid #cce0f5',
          borderRadius: '6px',
          padding: '7px 10px',
          marginBottom: '6px',
        });

        const text = document.createElement('div');
        text.textContent = line;
        Object.assign(text.style, { color: '#222', wordBreak: 'break-word' });

        if (dateMatch) {
          const tsEl = document.createElement('div');
          tsEl.textContent = dateMatch[1];
          Object.assign(tsEl.style, { fontSize: '11px', color: '#888', marginTop: '3px' });
          card.appendChild(text);
          card.appendChild(tsEl);
        } else {
          card.appendChild(text);
        }

        content.appendChild(card);
      });
    }

    panel.appendChild(header);
    panel.appendChild(content);
    document.body.appendChild(panel);
  }

  // ── Build main UI ─────────────────────────────────────────────────────────
  function buildUI() {
    if (document.getElementById('eib-logbook-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'eib-logbook-btn';
    btn.textContent = '📓 Logbook';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: '999999',
      background: '#1a6e3c',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      padding: '10px 16px',
      fontSize: '14px',
      fontFamily: 'sans-serif',
      cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    });
    btn.onclick = togglePanel;
    document.body.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = 'eib-logbook-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      bottom: '70px',
      right: '20px',
      zIndex: '999998',
      width: '500px',
      maxHeight: '75vh',
      background: '#fff',
      border: '1px solid #ccc',
      borderRadius: '10px',
      boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
      display: 'none',
      flexDirection: 'column',
      fontFamily: 'sans-serif',
      fontSize: '13px',
      overflow: 'hidden',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      background: '#1a6e3c',
      color: '#fff',
      padding: '10px 14px',
      fontWeight: 'bold',
      fontSize: '14px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexShrink: '0',
    });
    header.innerHTML = '<span>📓 Logbook</span>';

    const headerRight = document.createElement('div');
    Object.assign(headerRight.style, { display: 'flex', gap: '12px', alignItems: 'center' });

    const commentsBtn = document.createElement('span');
    commentsBtn.id = 'eib-comments-btn';
    commentsBtn.textContent = '💬';
    commentsBtn.title = 'Technician Comments';
    Object.assign(commentsBtn.style, { cursor: 'pointer', fontSize: '16px' });

    const refreshBtn = document.createElement('span');
    refreshBtn.textContent = '↻';
    refreshBtn.title = 'Refresh';
    Object.assign(refreshBtn.style, { cursor: 'pointer', fontSize: '20px' });
    refreshBtn.onclick = loadData;

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, { cursor: 'pointer', fontSize: '16px' });
    closeBtn.onclick = togglePanel;

    headerRight.appendChild(commentsBtn);
    headerRight.appendChild(refreshBtn);
    headerRight.appendChild(closeBtn);
    header.appendChild(headerRight);

    const content = document.createElement('div');
    content.id = 'eib-logbook-content';
    Object.assign(content.style, {
      overflowY: 'auto',
      padding: '12px',
      flex: '1',
      color: '#333',
      lineHeight: '1.5',
    });
    content.textContent = 'Loading…';

    panel.appendChild(header);
    panel.appendChild(content);
    document.body.appendChild(panel);
  }

  function togglePanel() {
    const panel = document.getElementById('eib-logbook-panel');
    if (!panel) return;
    panelVisible = !panelVisible;
    panel.style.display = panelVisible ? 'flex' : 'none';
    if (panelVisible) loadData();
    else {
      const cp = document.getElementById('eib-comments-panel');
      if (cp) { cp.remove(); commentsVisible = false; }
    }
  }

  function loadData() {
    const content = document.getElementById('eib-logbook-content');
    if (!content) return;
    content.textContent = 'Loading…';

    fetchData(
      function (data) {
        const content = document.getElementById('eib-logbook-content');
        content.innerHTML = '';

        const meter = (data.Meter || [])[0];
        if (!meter) {
          content.textContent = 'No meter data found.';
          return;
        }

        // Wire up comments button now that we have data
        const commentsBtn = document.getElementById('eib-comments-btn');
        if (commentsBtn) {
          commentsBtn.onclick = function () { buildCommentsPanel(meter.Comments); };
        }

        // Update header with street address
        const headerTitle = document.querySelector('#eib-logbook-panel span');
        if (headerTitle && meter.StreetAddress && meter.StreetAddress !== 'null') {
          headerTitle.textContent = '📓 Logbook ' + meter.StreetAddress;
        }

        // ── Meter info bar ──────────────────────────────────────────────
        const info = document.createElement('div');
        Object.assign(info.style, {
          fontSize: '11px',
          color: '#666',
          marginBottom: '10px',
          paddingBottom: '8px',
          borderBottom: '1px solid #eee',
          lineHeight: '1.8',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
        });

        const fields = [
          { label: '📍', value: [meter.StreetAddress, meter.City].filter(v => v && v !== 'null').join(', ') },
          { label: '⚙️', value: meter.InstallationType && meter.InstallationType !== 'null' ? meter.InstallationType : null },
          { label: '🖥️', value: meter.RpiModel && meter.RpiModel !== 'null' ? meter.RpiModel : null },
        ];

        fields.forEach(function (f) {
          if (!f.value) return;
          const chip = document.createElement('span');
          chip.textContent = f.label + ' ' + f.value;
          Object.assign(chip.style, {
            background: '#f0f0f0',
            borderRadius: '4px',
            padding: '2px 7px',
            fontSize: '11px',
            color: '#444',
          });
          info.appendChild(chip);
        });

        if (info.children.length === 0) {
          info.textContent = 'Meter ID: ' + (meter.Id || '?');
        }

        content.appendChild(info);

        const lines = (meter.Logbook || '').trim().split('\n').filter(l => l.trim());
        renderLogbook(content, lines);
      },
      function (err) {
        const content = document.getElementById('eib-logbook-content');
        if (content) content.textContent = '⚠️ ' + err;
      }
    );
  }

  // ── Init with retries for Angular SPA ────────────────────────────────────
  function init() {
    if (document.getElementById('eib-logbook-btn')) return;
    if (document.body) buildUI();
  }

  init();
  setTimeout(init, 1000);
  setTimeout(init, 3000);

})();
