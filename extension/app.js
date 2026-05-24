/* ================================================================
   TabHub — Dashboard App (Modern Edition)

   What this file does:
   1. Reads open browser tabs via chrome.tabs.query()
   2. Groups tabs by domain OR by window (toggleable)
   3. Renders cards with tab rows
   4. Handles all user actions (close, save, focus)
   5. Manages quick links (stored in chrome.storage.local)
   6. Manages "Saved for Later" tabs
   ================================================================ */

'use strict';

let openTabs = [];
let currentView = 'domain';

/* ----------------------------------------------------------------
   CHROME TABS API
   ---------------------------------------------------------------- */

async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    const dashboardUrl = `chrome-extension://${extensionId}/index.html`;
    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      windowId: t.windowId,
      active: t.active,
      isTabOut: t.url === dashboardUrl,
    }));
  } catch {
    openTabs = [];
  }
}

async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;
  const targetHostnames = [];
  const exactUrls = new Set();
  for (const u of urls) {
    if (u.startsWith('file://')) { exactUrls.add(u); }
    else { try { targetHostnames.push(new URL(u).hostname); } catch {} }
  }
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(tab => {
    const tabUrl = tab.url || '';
    if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
    try { return targetHostnames.includes(new URL(tabUrl).hostname); } catch { return false; }
  }).map(tab => tab.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  let matches = allTabs.filter(t => t.url === url);
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => { try { return new URL(t.url).hostname === targetHost; } catch { return false; } });
    } catch {}
  }
  if (matches.length === 0) return;
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];
  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) { if (tab.id !== keep.id) toClose.push(tab.id); }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const dashboardUrl = `chrome-extension://${extensionId}/index.html`;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t => t.url === dashboardUrl);
  if (tabOutTabs.length <= 1) return;
  const keep = tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) || tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/* ----------------------------------------------------------------
   SAVED FOR LATER
   ---------------------------------------------------------------- */

async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id: Date.now().toString(),
    url: tab.url,
    title: tab.title,
    savedAt: new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  return deferred.filter(t => !t.dismissed && !t.completed);
}

async function checkOffSavedTab(id) {
  const { deferred = [], frequent = [] } = await chrome.storage.local.get(['deferred', 'frequent']);
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
    const exists = frequent.find(f => f.url === tab.url);
    if (!exists) {
      frequent.push({
        id: Date.now().toString(),
        url: tab.url,
        title: tab.title,
        addedAt: new Date().toISOString(),
      });
      await chrome.storage.local.set({ frequent });
    }
  }
}

async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) { tab.dismissed = true; await chrome.storage.local.set({ deferred }); }
}

/* ----------------------------------------------------------------
   FREQUENT TABS (近期常用)
   ---------------------------------------------------------------- */

async function getFrequentTabs() {
  const { frequent = [] } = await chrome.storage.local.get('frequent');
  return frequent;
}

async function addFrequentTab(url, title) {
  const { frequent = [] } = await chrome.storage.local.get('frequent');
  const exists = frequent.find(f => f.url === url);
  if (exists) return false;
  frequent.push({
    id: Date.now().toString(),
    url: url,
    title: title || url,
    addedAt: new Date().toISOString(),
  });
  await chrome.storage.local.set({ frequent });
  return true;
}

async function removeFrequentTab(id) {
  const { frequent = [] } = await chrome.storage.local.get('frequent');
  const filtered = frequent.filter(f => f.id !== id);
  await chrome.storage.local.set({ frequent: filtered });
}

/* ----------------------------------------------------------------
   SESSIONS (会话管理)
   ---------------------------------------------------------------- */

async function getSessions() {
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  return sessions;
}

async function saveSession(name, tabs) {
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  sessions.push({
    id: Date.now().toString(),
    name: name,
    tabs: tabs.map(t => ({ url: t.url, title: t.title })),
    tabCount: tabs.length,
    createdAt: new Date().toISOString(),
  });
  await chrome.storage.local.set({ sessions });
}

async function deleteSession(id) {
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  const filtered = sessions.filter(s => s.id !== id);
  await chrome.storage.local.set({ sessions: filtered });
}

async function restoreSession(id) {
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  const session = sessions.find(s => s.id === id);
  if (!session) return;
  const urls = session.tabs.map(t => t.url).filter(Boolean);
  if (urls.length > 0) {
    await chrome.windows.create({ url: urls });
  }
}

/* ----------------------------------------------------------------
   QUICK LINKS
   ---------------------------------------------------------------- */

const DEFAULT_QUICK_LINKS = [
  { title: 'GitHub', url: 'https://github.com' },
  { title: 'Gmail', url: 'https://mail.google.com' },
  { title: 'YouTube', url: 'https://www.youtube.com' },
  { title: 'X', url: 'https://x.com' },
];

async function getQuickLinks() {
  const { quickLinks } = await chrome.storage.local.get('quickLinks');
  return quickLinks || DEFAULT_QUICK_LINKS;
}

async function saveQuickLinks(links) {
  await chrome.storage.local.set({ quickLinks: links });
}

function renderQuickLinks(links) {
  const container = document.getElementById('quickLinks');
  if (!container) return;
  container.innerHTML = links.map((link, i) => {
    let domain = '';
    try { domain = new URL(link.url).hostname; } catch {}
    const favicon = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="quick-link-wrapper">
      <a class="quick-link" href="${link.url}" target="_blank" rel="noopener" data-link-index="${i}">
        ${favicon ? `<img src="${favicon}" alt="" onerror="this.style.display='none'">` : ''}
        ${link.title}
      </a>
      <div class="quick-link-context" data-context-index="${i}">
        <button data-action="edit-quick-link" data-link-index="${i}">编辑</button>
        <button class="danger" data-action="delete-quick-link" data-link-index="${i}">删除</button>
      </div>
    </div>`;
  }).join('') + `
    <button class="quick-link quick-link-add" data-action="add-quick-link">+ 添加</button>`;
}

/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);
    setTimeout(() => ctx.close(), 500);
  } catch {}
}

function shootConfetti(x, y) {
  const colors = ['#4f46e5', '#818cf8', '#22c55e', '#86efac', '#f59e0b', '#fcd34d', '#ef4444', '#fca5a5'];
  const particleCount = 17;
  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');
    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6;
    const color = colors[Math.floor(Math.random() * colors.length)];
    el.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${color};border-radius:${isCircle ? '50%' : '2px'};pointer-events:none;z-index:9999;transform:translate(-50%,-50%);opacity:1;`;
    document.body.appendChild(el);
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 120;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 80;
    const gravity = 200;
    const startTime = performance.now();
    const duration = 700 + Math.random() * 200;
    function frame(now) {
      const elapsed = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);
      if (progress >= 1) { el.remove(); return; }
      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate = elapsed * 200 * (isCircle ? 0 : 1);
      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
}

function animateCardOut(card) {
  if (!card) return;
  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
  card.classList.add('closing');
  setTimeout(() => { card.remove(); checkAndShowEmptyState(); }, 300);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;
  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;
  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">全部清空。</div>
      <div class="empty-subtitle">当前没有需要管理的标签页。</div>
    </div>`;
  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 个分组';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now = new Date();
  const diffMins = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays = Math.floor((now - then) / 86400000);
  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return diffMins + ' 分钟前';
  if (diffHours < 24) return diffHours + ' 小时前';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return diffDays + ' 天前';
  return then.toLocaleDateString('zh-CN');
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function getDateDisplay() {
  return new Date().toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/* ----------------------------------------------------------------
   DOMAIN & TITLE HELPERS
   ---------------------------------------------------------------- */

const FRIENDLY_DOMAINS = {
  'github.com': 'GitHub', 'www.github.com': 'GitHub', 'gist.github.com': 'GitHub Gist',
  'youtube.com': 'YouTube', 'www.youtube.com': 'YouTube', 'music.youtube.com': 'YouTube Music',
  'x.com': 'X', 'www.x.com': 'X', 'twitter.com': 'X', 'www.twitter.com': 'X',
  'reddit.com': 'Reddit', 'www.reddit.com': 'Reddit', 'old.reddit.com': 'Reddit',
  'substack.com': 'Substack', 'www.substack.com': 'Substack',
  'medium.com': 'Medium', 'www.medium.com': 'Medium',
  'linkedin.com': 'LinkedIn', 'www.linkedin.com': 'LinkedIn',
  'stackoverflow.com': 'Stack Overflow', 'www.stackoverflow.com': 'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com': 'Google', 'www.google.com': 'Google',
  'mail.google.com': 'Gmail', 'docs.google.com': 'Google Docs',
  'drive.google.com': 'Google Drive', 'calendar.google.com': 'Google Calendar',
  'meet.google.com': 'Google Meet', 'gemini.google.com': 'Gemini',
  'chatgpt.com': 'ChatGPT', 'www.chatgpt.com': 'ChatGPT', 'chat.openai.com': 'ChatGPT',
  'claude.ai': 'Claude', 'www.claude.ai': 'Claude', 'code.claude.com': 'Claude Code',
  'notion.so': 'Notion', 'www.notion.so': 'Notion',
  'figma.com': 'Figma', 'www.figma.com': 'Figma',
  'slack.com': 'Slack', 'app.slack.com': 'Slack',
  'discord.com': 'Discord', 'www.discord.com': 'Discord',
  'wikipedia.org': 'Wikipedia', 'en.wikipedia.org': 'Wikipedia',
  'amazon.com': 'Amazon', 'www.amazon.com': 'Amazon',
  'netflix.com': 'Netflix', 'www.netflix.com': 'Netflix',
  'spotify.com': 'Spotify', 'open.spotify.com': 'Spotify',
  'vercel.com': 'Vercel', 'www.vercel.com': 'Vercel',
  'npmjs.com': 'npm', 'www.npmjs.com': 'npm',
  'developer.mozilla.org': 'MDN',
  'arxiv.org': 'arXiv', 'www.arxiv.org': 'arXiv',
  'huggingface.co': 'Hugging Face', 'www.huggingface.co': 'Hugging Face',
  'producthunt.com': 'Product Hunt', 'www.producthunt.com': 'Product Hunt',
  'xiaohongshu.com': 'RedNote', 'www.xiaohongshu.com': 'RedNote',
  'local-files': 'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];
  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }
  let clean = hostname.replace(/^www\./, '').replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');
  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';
  const friendly = friendlyDomain(hostname);
  const domain = hostname.replace(/^www\./, '');
  const seps = [' - ', ' | ', ' — ', ' · ', ' – '];
  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix = title.slice(idx + sep.length).trim();
    const suffixLow = suffix.toLowerCase();
    if (suffixLow === domain.toLowerCase() || suffixLow === friendly.toLowerCase() ||
        suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
        domain.toLowerCase().includes(suffixLow) || friendly.toLowerCase().includes(suffixLow)) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; } catch { return title || ''; }
  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');
  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }
  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull' && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }
  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }
  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) { if (titleIsUrl) return `r/${parts[subIdx + 1]} post`; }
  }
  return title || url;
}

/* ----------------------------------------------------------------
   SVG ICONS
   ---------------------------------------------------------------- */

const ICONS = {
  tabs: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};

/* ----------------------------------------------------------------
   IN-MEMORY STORE
   ---------------------------------------------------------------- */

let domainGroups = [];

/* ----------------------------------------------------------------
   HELPERS
   ---------------------------------------------------------------- */

function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return !url.startsWith('chrome://') && !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') && !url.startsWith('edge://') && !url.startsWith('brave://');
  });
}

function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;
  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

/* ----------------------------------------------------------------
   OVERFLOW CHIPS
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count = urlCounts[tab.url] || 1;
    const dupeTag = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" draggable="true" data-action="focus-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="稍后阅读">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="关闭标签">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');
  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} 更多</span>
    </div>`;
}

/* ----------------------------------------------------------------
   SESSIONS RENDERER (会话管理)
   ---------------------------------------------------------------- */

async function renderSessionsSection() {
  const section = document.getElementById('sessionsSection');
  const list = document.getElementById('sessionsList');
  const empty = document.getElementById('sessionsEmpty');
  const countEl = document.getElementById('sessionsCount');
  if (!section) return;

  try {
    const sessions = await getSessions();
    if (sessions.length === 0) {
      section.style.display = 'none';
      return;
    }
    section.style.display = 'block';

    countEl.textContent = `${sessions.length} 个会话`;
    list.innerHTML = sessions.map(s => renderSessionCard(s)).join('');
    list.style.display = 'block';
    empty.style.display = 'none';
  } catch (err) {
    console.warn('[tabhub] Could not load sessions:', err);
    section.style.display = 'none';
  }
}

function renderSessionCard(session) {
  const ago = timeAgo(session.createdAt);
  const previewTitles = session.tabs.slice(0, 4).map(t => {
    const title = t.title || t.url || '';
    return title.length > 30 ? title.slice(0, 30) + '…' : title;
  });
  const moreCount = session.tabs.length > 4 ? ` +${session.tabs.length - 4}` : '';

  return `
    <div class="session-card" data-session-id="${session.id}">
      <div class="session-card-header">
        <span class="session-name">${session.name}</span>
        <span class="session-tab-count">${session.tabCount} 个标签</span>
      </div>
      <div class="session-preview">
        ${previewTitles.map(t => `<span class="session-tab-title">${t}</span>`).join('')}
        ${moreCount ? `<span class="session-tab-more">${moreCount}</span>` : ''}
      </div>
      <div class="session-meta">
        <span>${ago}</span>
      </div>
      <div class="session-actions">
        <button class="action-btn primary" data-action="restore-session" data-session-id="${session.id}">恢复会话</button>
        <button class="action-btn danger" data-action="delete-session" data-session-id="${session.id}">删除</button>
      </div>
    </div>`;
}

function showSaveSessionModal() {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>保存当前会话</h3>
      <div class="modal-field">
        <label>会话名称</label>
        <input type="text" id="sessionName" placeholder="例如：工作、个人项目、旅行规划" autofocus>
      </div>
      <div class="modal-actions">
        <button class="modal-btn-cancel" id="sessionCancel">取消</button>
        <button class="modal-btn-save" id="sessionSave">保存</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('sessionCancel').addEventListener('click', () => overlay.remove());

  document.getElementById('sessionSave').addEventListener('click', async () => {
    const name = document.getElementById('sessionName').value.trim();
    if (!name) return;
    const realTabs = getRealTabs();
    if (realTabs.length === 0) {
      showToast('没有可保存的标签页');
      overlay.remove();
      return;
    }
    await saveSession(name, realTabs);
    overlay.remove();
    showToast(`已保存会话「${name}」（${realTabs.length} 个标签）`);
    await renderSessionsSection();
  });

  setTimeout(() => document.getElementById('sessionName')?.focus(), 100);
}

/* ----------------------------------------------------------------
   CARD RENDERER
   ---------------------------------------------------------------- */

function renderDomainCard(group) {
  const tabs = group.tabs || [];
  const tabCount = tabs.length;
  const stableId = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">${ICONS.tabs}${tabCount} 个标签</span>`;
  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--warning);background:var(--warning-light);">${totalExtras} 个重复</span>`
    : '';

  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) { if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); } }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count = urlCounts[tab.url];
    const dupeTag = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="稍后阅读">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="关闭标签">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close} 关闭全部 ${tabCount} 个标签
    </button>`;
  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        关闭 ${totalExtras} 个重复
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${group.label || friendlyDomain(group.domain)}</span>
          ${tabBadge} ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">标签</div>
      </div>
    </div>`;
}

function renderWindowCard(group) {
  const tabs = group.tabs || [];
  const tabCount = tabs.length;
  const stableId = 'window-' + group.windowId;

  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">${ICONS.tabs}${tabCount} 个标签</span>`;
  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--warning);background:var(--warning-light);">${totalExtras} 个重复</span>`
    : '';

  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) { if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); } }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count = urlCounts[tab.url];
    const dupeTag = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" draggable="true" data-action="focus-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="稍后阅读">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="关闭标签">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-window-tabs" data-window-id="${group.windowId}">
      ${ICONS.close} 关闭全部 ${tabCount} 个标签
    </button>`;
  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        关闭 ${totalExtras} 个重复
      </button>`;
  }

  return `
    <div class="mission-card window-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-window-id="${group.windowId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">窗口 ${group.windowIndex}</span>
          ${tabBadge} ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">标签</div>
      </div>
    </div>`;
}

/* ----------------------------------------------------------------
   SAVED FOR LATER RENDERER
   ---------------------------------------------------------------- */

async function renderDeferredColumn() {
  const column = document.getElementById('deferredColumn');
  const list = document.getElementById('deferredList');
  const empty = document.getElementById('deferredEmpty');
  const countEl = document.getElementById('deferredCount');
  if (!column) return;

  try {
    const active = await getSavedTabs();
    if (active.length === 0) {
      countEl.textContent = '0 项';
      list.innerHTML = '';
      list.style.display = 'none';
      empty.style.display = 'block';
      return;
    }
    column.style.display = 'block';

    countEl.textContent = `${active.length} 项`;
    list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
    list.style.display = 'block';
    empty.style.display = 'none';
  } catch (err) {
    console.warn('[tabhub] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const ago = timeAgo(item.savedAt);
  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}" title="移入近期常用">
      <div class="deferred-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" onerror="this.style.display='none'">${item.title || item.url}
        </a>
        <div class="deferred-meta"><span>${domain}</span><span>${ago}</span></div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="忽略">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/* ----------------------------------------------------------------
   FREQUENT TABS RENDERER (近期常用)
   ---------------------------------------------------------------- */

async function renderFrequentColumn() {
  const column = document.getElementById('frequentColumn');
  const list = document.getElementById('frequentList');
  const empty = document.getElementById('frequentEmpty');
  const countEl = document.getElementById('frequentCount');
  if (!column) return;

  try {
    const frequent = await getFrequentTabs();
    if (frequent.length === 0) {
      countEl.textContent = '0 项';
      list.innerHTML = '';
      list.style.display = 'none';
      empty.style.display = 'block';
      return;
    }
    column.style.display = 'block';

    countEl.textContent = `${frequent.length} 项`;
    list.innerHTML = frequent.map(item => renderFrequentItem(item)).join('');
    list.style.display = 'block';
    empty.style.display = 'none';
  } catch (err) {
    console.warn('[tabhub] Could not load frequent tabs:', err);
    column.style.display = 'none';
  }
}

function renderFrequentItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const ago = timeAgo(item.addedAt);
  return `
    <div class="frequent-item" data-frequent-id="${item.id}">
      <div class="frequent-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="frequent-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" onerror="this.style.display='none'">${item.title || item.url}
        </a>
        <div class="frequent-meta"><span>${domain}</span><span>${ago}</span></div>
      </div>
      <button class="frequent-remove" data-action="remove-frequent" data-frequent-id="${item.id}" title="移除">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

async function renderDashboard() {
  const greetingEl = document.getElementById('greeting');
  const dateEl = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl) dateEl.textContent = getDateDisplay();

  await fetchOpenTabs();
  const realTabs = getRealTabs();

  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname ? parsed.hostname === r.hostname
          : r.hostnameEndsWith ? parsed.hostname.endsWith(r.hostnameEndsWith) : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true;
      }) || null;
    } catch { return null; }
  }

  const openTabsSection = document.getElementById('openTabsSection');
  const openTabsMissionsEl = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (currentView === 'domain') {
    domainGroups = [];
    const groupMap = {};
    for (const tab of realTabs) {
      try {
        const customRule = matchCustomGroup(tab.url);
        if (customRule) {
          const key = customRule.groupKey;
          if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
          groupMap[key].tabs.push(tab);
          continue;
        }
        let hostname;
        if (tab.url && tab.url.startsWith('file://')) { hostname = 'local-files'; }
        else { hostname = new URL(tab.url).hostname; }
        if (!hostname) continue;
        if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
        groupMap[hostname].tabs.push(tab);
      } catch {}
    }

    domainGroups = Object.values(groupMap).sort((a, b) => b.tabs.length - a.tabs.length);

    if (domainGroups.length > 0 && openTabsSection) {
      if (openTabsSectionTitle) openTabsSectionTitle.textContent = '打开的标签页';
      openTabsSectionCount.innerHTML = `${domainGroups.length} 个域名 &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} 关闭全部 ${realTabs.length} 个标签</button>`;
      openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
      openTabsSection.style.display = 'block';
    } else if (openTabsSection) {
      openTabsSection.style.display = 'none';
    }
  } else {
    const windowMap = {};
    let windowIndex = 0;
    for (const tab of realTabs) {
      const wid = tab.windowId;
      if (!windowMap[wid]) { windowMap[wid] = { windowId: wid, windowIndex: ++windowIndex, tabs: [] }; }
      windowMap[wid].tabs.push(tab);
    }
    domainGroups = Object.values(windowMap).sort((a, b) => a.windowIndex - b.windowIndex);

    if (domainGroups.length > 0 && openTabsSection) {
      if (openTabsSectionTitle) openTabsSectionTitle.textContent = '打开的标签页';
      openTabsSectionCount.innerHTML = `${domainGroups.length} 个窗口 &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} 关闭全部 ${realTabs.length} 个标签</button>`;
      openTabsMissionsEl.innerHTML = domainGroups.map(g => renderWindowCard(g)).join('');
      openTabsSection.style.display = 'block';
    } else if (openTabsSection) {
      openTabsSection.style.display = 'none';
    }
  }

  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  checkTabOutDupes();
  await renderDeferredColumn();
  await renderFrequentColumn();
  await renderSessionsSection();

  const quickLinks = await getQuickLinks();
  renderQuickLinks(quickLinks);
}

/* ----------------------------------------------------------------
   EVENT HANDLERS
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) { banner.style.transition = 'opacity 0.4s'; banner.style.opacity = '0'; setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400); }
    showToast('已关闭多余的 TabHub 页面');
    return;
  }

  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) { overflowContainer.style.display = 'contents'; actionEl.remove(); }
    return;
  }

  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  if (action === 'close-single-tab') {
    e.stopPropagation();
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;
    const allTabs = await chrome.tabs.query({});
    const match = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();
    playCloseSound();
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity = '0';
      chip.style.transform = 'scale(0.8)';
      setTimeout(() => { chip.remove(); renderDashboard(); }, 200);
    } else { renderDashboard(); }
    return;
  }

  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle;
    if (tabUrl) {
      await saveTabForLater({ url: tabUrl, title: tabTitle || tabUrl });
      showToast('已保存到稍后阅读');
      await renderDeferredColumn();
    }
    return;
  }

  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group = domainGroups.find(g => 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId);
    if (group) {
      const urls = group.tabs.map(t => t.url);
      await closeTabsByUrls(urls);
      playCloseSound();
      const card = actionEl.closest('.mission-card');
      if (card) animateCardOut(card);
      showToast(`已关闭 ${group.tabs.length} 个标签`);
      setTimeout(() => renderDashboard(), 350);
    }
    return;
  }

  if (action === 'close-window-tabs') {
    const windowId = parseInt(actionEl.dataset.windowId);
    const group = domainGroups.find(g => g.windowId === windowId);
    if (group) {
      const tabIds = group.tabs.map(t => t.id).filter(Boolean);
      if (tabIds.length > 0) await chrome.tabs.remove(tabIds);
      await fetchOpenTabs();
      playCloseSound();
      const card = actionEl.closest('.mission-card');
      if (card) animateCardOut(card);
      showToast(`已关闭 ${group.tabs.length} 个标签`);
      setTimeout(() => renderDashboard(), 350);
    }
    return;
  }

  if (action === 'close-all-open-tabs') {
    const realTabs = getRealTabs();
    const tabIds = realTabs.map(t => t.id).filter(Boolean);
    if (tabIds.length > 0) await chrome.tabs.remove(tabIds);
    await fetchOpenTabs();
    playCloseSound();
    showToast(`已关闭 ${tabIds.length} 个标签`);
    renderDashboard();
    return;
  }

  if (action === 'dedup-keep-one') {
    const urls = actionEl.dataset.dupeUrls.split(',').map(decodeURIComponent);
    await closeDuplicateTabs(urls, true);
    playCloseSound();
    showToast('已关闭重复标签');
    renderDashboard();
    return;
  }

  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    await checkOffSavedTab(id);
    const item = actionEl.closest('.deferred-item');
    if (item) { item.classList.add('checked'); setTimeout(() => { renderDeferredColumn(); renderFrequentColumn(); }, 400); }
    return;
  }

  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    await dismissSavedTab(id);
    const item = actionEl.closest('.deferred-item');
    if (item) { item.classList.add('removing'); setTimeout(() => { item.remove(); renderDeferredColumn(); }, 300); }
    return;
  }

  if (action === 'remove-frequent') {
    const id = actionEl.dataset.frequentId;
    await removeFrequentTab(id);
    const item = actionEl.closest('.frequent-item');
    if (item) { item.classList.add('removing'); setTimeout(() => { item.remove(); renderFrequentColumn(); }, 300); }
    showToast('已从近期常用中移除');
    return;
  }

  if (action === 'save-session') {
    showSaveSessionModal();
    return;
  }

  if (action === 'restore-session') {
    const id = actionEl.dataset.sessionId;
    await restoreSession(id);
    showToast('会话已在新窗口中恢复');
    return;
  }

  if (action === 'delete-session') {
    const id = actionEl.dataset.sessionId;
    await deleteSession(id);
    const card = actionEl.closest('.session-card');
    if (card) { card.classList.add('removing'); setTimeout(() => { card.remove(); renderSessionsSection(); }, 300); }
    showToast('会话已删除');
    return;
  }

  if (action === 'add-quick-link') {
    showQuickLinkModal();
    return;
  }

  if (action === 'edit-quick-link') {
    const index = parseInt(actionEl.dataset.linkIndex);
    const links = await getQuickLinks();
    if (links[index]) showQuickLinkModal(links[index], index);
    return;
  }

  if (action === 'delete-quick-link') {
    const index = parseInt(actionEl.dataset.linkIndex);
    const links = await getQuickLinks();
    links.splice(index, 1);
    await saveQuickLinks(links);
    renderQuickLinks(links);
    showToast('快捷链接已移除');
    return;
  }
});

document.addEventListener('click', (e) => {
  const toggleBtn = e.target.closest('.view-toggle-btn');
  if (toggleBtn) {
    document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
    toggleBtn.classList.add('active');
    currentView = toggleBtn.dataset.view;
    renderDashboard();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.quick-link-wrapper')) {
    document.querySelectorAll('.quick-link-context.show').forEach(c => c.classList.remove('show'));
  }
});

document.addEventListener('contextmenu', (e) => {
  const wrapper = e.target.closest('.quick-link-wrapper');
  if (wrapper) {
    e.preventDefault();
    document.querySelectorAll('.quick-link-context.show').forEach(c => c.classList.remove('show'));
    const context = wrapper.querySelector('.quick-link-context');
    if (context) context.classList.add('show');
  }
});

/* ----------------------------------------------------------------
   DRAG AND DROP (mouse-based, more reliable than HTML5 DnD)
   ---------------------------------------------------------------- */

let dragState = null;

document.addEventListener('mousedown', (e) => {
  const chip = e.target.closest('.page-chip[data-tab-url]');
  if (!chip) return;
  if (e.target.closest('.chip-action')) return;
  if (e.button !== 0) return;

  const url = chip.dataset.tabUrl;
  const title = chip.dataset.tabTitle || chip.querySelector('.chip-text')?.textContent?.trim() || url;
  if (!url) return;

  dragState = {
    chip,
    url,
    title,
    startX: e.clientX,
    startY: e.clientY,
    ghost: null,
    started: false,
  };
});

document.addEventListener('mousemove', (e) => {
  if (!dragState) return;

  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (!dragState.started && dist < 5) return;

  if (!dragState.started) {
    dragState.started = true;
    dragState.chip.classList.add('dragging', 'dragging-active');

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = dragState.title.length > 40 ? dragState.title.slice(0, 40) + '…' : dragState.title;
    document.body.appendChild(ghost);
    dragState.ghost = ghost;
  }

  dragState.ghost.style.left = (e.clientX + 12) + 'px';
  dragState.ghost.style.top = (e.clientY + 12) + 'px';

  const dropZone = e.target.closest('#deferredColumn, #frequentColumn');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  if (dropZone) {
    dropZone.classList.add('drag-over');
  }
});

document.addEventListener('mouseup', async (e) => {
  if (!dragState) return;

  const dropZone = e.target.closest('#deferredColumn, #frequentColumn');

  if (dragState.ghost) dragState.ghost.remove();
  if (dragState.chip) dragState.chip.classList.remove('dragging', 'dragging-active');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

  if (dragState.started && dropZone) {
    if (dropZone.id === 'deferredColumn') {
      await saveTabForLater({ url: dragState.url, title: dragState.title });
      showToast('已保存到稍后阅读');
      await renderDeferredColumn();
    } else if (dropZone.id === 'frequentColumn') {
      const added = await addFrequentTab(dragState.url, dragState.title);
      if (added) {
        showToast('已添加到近期常用');
        await renderFrequentColumn();
      } else {
        showToast('该页面已在近期常用中');
      }
    }
  }

  dragState = null;
});

/* ----------------------------------------------------------------
   QUICK LINK MODAL
   ---------------------------------------------------------------- */

function showQuickLinkModal(link = null, index = null) {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const isEdit = link !== null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? '编辑快捷链接' : '添加快捷链接'}</h3>
      <div class="modal-field">
        <label>标题</label>
        <input type="text" id="qlTitle" value="${link ? link.title : ''}" placeholder="例如：GitHub">
      </div>
      <div class="modal-field">
        <label>网址</label>
        <input type="text" id="qlUrl" value="${link ? link.url : ''}" placeholder="https://...">
      </div>
      <div class="modal-actions">
        ${isEdit ? '<button class="modal-btn-delete" id="qlDelete">删除</button>' : ''}
        <button class="modal-btn-cancel" id="qlCancel">取消</button>
        <button class="modal-btn-save" id="qlSave">保存</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('qlCancel').addEventListener('click', () => overlay.remove());

  document.getElementById('qlSave').addEventListener('click', async () => {
    const title = document.getElementById('qlTitle').value.trim();
    const url = document.getElementById('qlUrl').value.trim();
    if (!title || !url) return;
    const links = await getQuickLinks();
    if (isEdit) { links[index] = { title, url }; }
    else { links.push({ title, url }); }
    await saveQuickLinks(links);
    renderQuickLinks(links);
    overlay.remove();
    showToast(isEdit ? '快捷链接已更新' : '快捷链接已添加');
  });

  if (isEdit) {
    document.getElementById('qlDelete').addEventListener('click', async () => {
      const links = await getQuickLinks();
      links.splice(index, 1);
      await saveQuickLinks(links);
      renderQuickLinks(links);
      overlay.remove();
      showToast('快捷链接已移除');
    });
  }
}

/* ----------------------------------------------------------------
   INIT
   ---------------------------------------------------------------- */

renderDashboard();
