// 共用工具
const TYPE_LABEL = { single: '單選題', multi: '多選題', literacy: '素養題', translation: '翻譯題' };
const OPT_SHAPES = ['♥', '★', '●', '▲', '◆', '✿'];
const LETTERS = 'ABCDEF';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function applyTheme(t) {
  if (!t) return;
  const r = document.documentElement.style;
  const c = t.colors || {};
  for (const k of ['bg', 'bg2', 'primary', 'accent', 'text', 'card']) if (c[k]) r.setProperty('--' + k, c[k]);
  if (t.bgImage) {
    document.body.style.backgroundImage = `url("${encodeURI(t.bgImage)}")`;
    document.body.classList.add('has-bg-img');
  } else {
    document.body.style.backgroundImage = '';
    document.body.classList.remove('has-bg-img');
  }
  $$('[data-mascot]').forEach(img => { img.src = t.mascot || 'img/mascot.svg'; });
}

let toastTimer;
function toast(msg, ms = 2600) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

// 倒數計時（用本機時間 + 伺服器給的剩餘毫秒，避免時鐘誤差）
class Countdown {
  constructor(onTick, onDone) { this.onTick = onTick; this.onDone = onDone; this.id = null; }
  start(remainingMs, totalMs) {
    this.stop();
    this.end = performance.now() + remainingMs;
    this.total = totalMs;
    const tick = () => {
      const left = Math.max(0, this.end - performance.now());
      this.onTick(left, this.total);
      if (left <= 0) { this.stop(); this.onDone && this.onDone(); }
    };
    tick();
    this.id = setInterval(tick, 100);
  }
  stop() { clearInterval(this.id); this.id = null; }
}

function confetti(n = 120) {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#ff6b9a', '#4aa8f0', '#f5b800', '#3fbf6a', '#a585f5', '#ff8a3d', '#ffffff'];
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = 2.5 + Math.random() * 3 + 's';
    p.style.animationDelay = Math.random() * 1.5 + 's';
    p.style.borderRadius = Math.random() > .5 ? '50%' : '3px';
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 8000);
}

function normalizeText(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/[.。!！?？,，、;；:："“”'‘’`]/g, '').replace(/\s+/g, ' ').trim();
}
// 名稱轉成可當資料庫文件 ID 的形式
function cleanName(n) {
  return String(n || '').replace(/[\/\\]/g, '').replace(/\s+/g, ' ').replace(/^\.+|\.+$/g, '').replace(/__/g, '_').trim().slice(0, 12);
}
