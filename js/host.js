// 主持大螢幕：負責控制流程與計分
import * as fb from './fb.js';

const pin = (new URLSearchParams(location.search).get('pin') || '').trim();
const gp = p => `games/${pin}${p || ''}`;
const RING = 439.8;

let game = null, questions = [], scores = {}, players = {}, answers = {};
let unsubAnswers = null, answersIndex = -1, qTimer = null, busy = false, started = false;
let autoTimer = null, paused = false;

const cd = new Countdown((left, t) => {
  const s = Math.ceil(left / 1000);
  $('#secs').textContent = s;
  $('#ring').style.strokeDashoffset = RING * (1 - left / t);
  $('#clock').classList.toggle('warn', s <= 5);
});

function view(id) { $$('.stage > section').forEach(s => s.classList.toggle('hidden', s.id !== id)); }
function setNext(label, enabled = true) { $('#btn-next').textContent = label; $('#btn-next').disabled = !enabled; }
function fail(msg) { view('v-error'); $('#err-msg').textContent = msg; $('.bottombar').classList.add('hidden'); }
window.toggleFs = () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); };
const playerCount = () => Object.keys(players).length;

if (!pin) fail('請從後台建立遊戲後開啟主持畫面');
else fb.onUser(async u => {
  if (started) return;
  if (!u || u.anonymous) return fail('請先在同一個瀏覽器登入後台，再開啟主持畫面');
  started = true;
  try { await init(); } catch (e) { console.error(e); fail(fb.isPermissionError(e) ? '這個帳號沒有主持權限' : '載入失敗：' + e.message); }
});

async function init() {
  const g = await fb.get(gp());
  if (!g) return fail('找不到這個遊戲（可能已被清除）');
  const [pq, st, theme] = await Promise.all([fb.get(gp('/private/questions')), fb.get(gp('/private/state')), fb.get(gp('/theme/main'))]);
  questions = (pq && pq.list) || [];
  scores = (st && st.scores) || {};
  applyTheme(theme);
  $('#title').textContent = g.title;
  document.title = g.title + ' · 主持畫面';
  $('#pin-pill').textContent = '代碼 ' + pin;
  $('#pin-big').textContent = pin;
  const joinUrl = new URL('index.html?pin=' + pin, location.href).href;
  const qr = qrcode(0, 'M'); qr.addData(joinUrl); qr.make();
  $('#qr').src = qr.createDataURL(10, 2);
  $('#join-url').textContent = joinUrl;

  fb.listenColl(gp('/players'), list => {
    players = {};
    list.forEach(p => { players[p.id] = { name: p.name, joinedAt: p.joinedAt || 0 }; });
    renderPlayers();
    updateAnswered();
  }, null, e => console.error(e));

  fb.listenDoc(gp(), d => { if (d) { game = d; render(); } }, e => console.error(e));
}

// ---------- 畫面 ----------
function renderPlayers() {
  const list = Object.entries(players).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  $('#count').textContent = list.length;
  const box = $('#players');
  box.innerHTML = '';
  list.forEach(([id, p]) => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.textContent = p.name;
    c.title = '點一下移除';
    c.onclick = () => { if (confirm(`要把「${p.name}」移出遊戲嗎？`)) kick(id); };
    box.appendChild(c);
  });
  if (game && game.state === 'lobby') setNext('開始遊戲 ▶', list.length > 0);
}

function renderQuestionBody(g) {
  const q = g.q;
  $('#q-num').textContent = `第 ${g.index + 1} / ${g.total} 題`;
  $('#q-type').textContent = TYPE_LABEL[q.type];
  $('#q-type').className = 'tag ' + q.type;
  $('#q-mode').textContent = q.input === 'text' ? '✏️ 打字作答' : q.multi ? '✅ 可複選' : '👆 單選';
  $('#q-text').textContent = q.text;
  $('#q-passage').classList.toggle('hidden', !q.passage);
  $('#q-passage').textContent = q.passage || '';
  const box = $('#h-opts'); box.innerHTML = '';
  $('#h-typing').classList.toggle('hidden', q.input !== 'text');
  (q.options || []).forEach((t, i) => {
    const d = document.createElement('div');
    d.className = 'opt o' + i;
    d.innerHTML = `<span class="shape">${OPT_SHAPES[i]}</span><span>${esc(t)}</span>`;
    box.appendChild(d);
  });
}

let renderedKey = '';
function render() {
  const g = game;
  const key = g.state + ':' + g.index + ':' + (g.qStartedAt || 0);
  const sameView = key === renderedKey;
  renderedKey = key;
  if (!sameView) clearAuto();
  $('#btn-pause').classList.toggle('hidden', !(g.auto && ['question', 'reveal', 'leaderboard'].includes(g.state)));
  $('#btn-finish').classList.toggle('hidden', !['question', 'reveal', 'leaderboard'].includes(g.state));

  if (g.state === 'lobby') {
    view('v-lobby');
    setNext('開始遊戲 ▶', playerCount() > 0);
    $('#status').textContent = `共 ${g.total} 題，等同學加入中…`;
    return;
  }
  if (g.state === 'question') {
    if (answersIndex !== g.index) watchAnswers(g.index);
    if (sameView) return;
    view('v-question');
    renderQuestionBody(g);
    $('#reveal-extra').classList.add('hidden');
    const total = g.duration * 1000;
    const remaining = Math.max(0, Math.min(total, (g.qStartedAt || Date.now()) + total - Date.now()));
    cd.start(remaining, total);
    clearTimeout(qTimer);
    qTimer = setTimeout(endQuestion, remaining + 1500); // 多等 1.5 秒讓網路慢的同學送達
    updateAnswered();
    setNext('結束這題 ⏭');
    $('#status').textContent = '作答中…';
    return;
  }
  stopAnswers();
  clearTimeout(qTimer);
  cd.stop();
  if (g.state === 'reveal') {
    if (sameView) return;
    const r = g.reveal;
    view('v-question');
    renderQuestionBody(g);
    $('#secs').textContent = '0';
    $('#ring').style.strokeDashoffset = RING;
    $$('#h-opts .opt').forEach((el, i) => {
      el.classList.add(r.answer.includes(i) ? 'correct' : 'dim');
      el.insertAdjacentHTML('beforeend', `<span class="cnt">${r.counts[i] || 0} 人</span>`);
    });
    $('#h-typing').classList.add('hidden');
    $('#reveal-extra').classList.remove('hidden');
    const pct = r.totalPlayers ? Math.round(r.correctCount / r.totalPlayers * 100) : 0;
    $('#rv-summary').textContent = `🎯 ${r.correctCount} 人答對（${pct}%）· ${r.answeredCount} / ${r.totalPlayers} 人有作答`;
    $('#rv-accepted').innerHTML = g.q.input === 'text' ? '正確答案：' + r.accepted.map(a => `<span class="accepted">${esc(a)}</span>`).join('') : '';
    $('#rv-wrong').textContent = r.wrongTop && r.wrongTop.length ? '常見錯誤：' + r.wrongTop.map(w => `${w.text}（${w.n}）`).join('、') : '';
    $('#rv-explain').textContent = r.explanation ? '💡 ' + r.explanation : '';
    setNext(r.isLast ? '看最終排名 🏆' : (g.auto && !(g.boardSecs > 0) ? '下一題 ▶' : '看排行榜 ▶'));
    $('#status').textContent = '公布答案';
    scheduleAuto(g.revealSecs);
    return;
  }
  if (g.state === 'leaderboard') {
    if (sameView) return;
    view('v-leader');
    $('#lb-progress').textContent = `（${g.index + 1} / ${g.total} 題）`;
    $('#board').innerHTML = (g.top || []).map((p, i) => `
      <div class="row" style="animation-delay:${i * .12}s">
        <span class="rk">${p.rank}</span><span class="nm">${esc(p.name)}</span>
        ${p.streak >= 2 ? `<span class="fire">🔥×${p.streak}</span>` : ''}
        <span>${p.score}</span>
      </div>`).join('') || '<div class="card">還沒有人得分</div>';
    setNext('下一題 ▶');
    $('#status').textContent = '';
    scheduleAuto(g.boardSecs);
    return;
  }
  if (g.state === 'final') {
    if (sameView) return;
    view('v-final');
    const t = (g.final && g.final.top10) || [];
    const col = (p, cls, medal) => p ? `
      <div class="pcol ${cls}">
        <div class="who">${cls === 'p1' ? '<div class="crown">👑</div>' : ''}<div class="medal">${medal}</div>
          <div class="pname">${esc(p.name)}</div><div class="pscore">${p.score} 分 · 答對 ${p.correctCount} 題</div></div>
        <div class="block">${p.rank}</div>
      </div>` : `<div class="pcol ${cls}" style="visibility:hidden"><div class="block"></div></div>`;
    $('#podium').innerHTML = col(t[1], 'p2', '🥈') + col(t[0], 'p1', '🥇') + col(t[2], 'p3', '🥉');
    $('#rest').innerHTML = t.slice(3).map(p => `
      <div class="row"><span class="rk">${p.rank}</span><span class="nm">${esc(p.name)}</span><span>${p.score}</span></div>`).join('');
    setTimeout(() => confetti(160), 1800);
    $('#btn-next').classList.add('hidden');
    $('#status').innerHTML = `共 ${(g.final && g.final.totalPlayers) || 0} 人參加 · <a href="admin.html">回後台</a>`;
  }
}

// ---------- 自動進行 ----------
function clearAuto() { clearInterval(autoTimer); autoTimer = null; }
function scheduleAuto(secs) {
  clearAuto();
  if (!game || !game.auto || paused) return;
  let left = Math.max(1, Number(secs) || 5);
  const tick = () => {
    if (left <= 0) { clearAuto(); advance(true); return; }
    $('#status').textContent = `⏩ ${left} 秒後自動繼續（可按「暫停自動」）`;
    left--;
  };
  tick();
  autoTimer = setInterval(tick, 1000);
}
$('#btn-pause').onclick = () => {
  paused = !paused;
  $('#btn-pause').textContent = paused ? '▶ 繼續自動' : '⏸ 暫停自動';
  if (paused) { clearAuto(); $('#status').textContent = '⏸ 已暫停自動進行，請按右邊按鈕繼續'; }
  else if (game && game.state === 'reveal') scheduleAuto(game.revealSecs);
  else if (game && game.state === 'leaderboard') scheduleAuto(game.boardSecs);
};

function updateAnswered() {
  const n = Object.keys(answers).filter(u => players[u]).length;
  $('#ans-count').textContent = n;
  $('#ans-total').textContent = playerCount();
  if (game && game.state === 'question' && playerCount() > 0 && n >= playerCount()) {
    clearTimeout(qTimer);
    qTimer = setTimeout(endQuestion, 700);
  }
}

function watchAnswers(index) {
  stopAnswers();
  answersIndex = index;
  answers = {};
  unsubAnswers = fb.listenColl(gp('/answers'), docs => {
    answers = {};
    docs.forEach(d => { answers[d.uid] = d; });
    updateAnswered();
  }, ['index', index], e => console.error(e));
}
function stopAnswers() { if (unsubAnswers) unsubAnswers(); unsubAnswers = null; answersIndex = -1; }

// ---------- 流程 ----------
function publicQuestion(q) {
  return { type: q.type, text: q.text, passage: q.passage || '', options: q.options || [], multi: !!q.multi, input: q.input };
}

async function startQuestion(i) {
  const q = questions[i];
  answers = {};
  await fb.update(gp(), {
    state: 'question', index: i, q: publicQuestion(q), qStartedAt: fb.SERVER_TIME(), duration: q.time,
    reveal: fb.DELETE(), top: fb.DELETE()
  });
}

function judge(q, a) {
  if (q.input === 'text') return typeof a.text === 'string' && q.accepted.some(x => normalizeText(x) === normalizeText(a.text));
  const ch = [...new Set((a.choices || []).filter(n => Number.isInteger(n) && n >= 0 && n < q.options.length))];
  if (!q.multi && ch.length !== 1) return false;
  return ch.length === q.answer.length && ch.every(c => q.answer.includes(c));
}

function ranking() {
  return Object.keys(players).map(uid => [uid, scores[uid] || (scores[uid] = { score: 0, correct: 0, time: 0, streak: 0 })])
    .sort((a, b) => b[1].score - a[1].score || a[1].time - b[1].time || (players[a[0]].joinedAt - players[b[0]].joinedAt));
}

async function endQuestion() {
  if (busy || !game || game.state !== 'question') return;
  busy = true;
  clearTimeout(qTimer);
  try {
    const g = game, q = questions[g.index];
    const start = g.qStartedAt || Date.now();
    const dur = g.duration * 1000;
    const got = {};
    for (const [uid, a] of Object.entries(answers)) {
      if (!players[uid] || a.index !== g.index) continue;
      const at = a.at || Date.now();
      const elapsed = at - start;
      if (elapsed < -2000 || elapsed > dur + 2500) continue; // 太早或太晚的答案不算
      got[uid] = { a, elapsed: Math.min(dur, Math.max(0, elapsed)) };
    }
    const counts = (q.options || []).map(() => 0);
    const wrong = {};
    let correctCount = 0;
    const perPlayer = {};
    for (const uid of Object.keys(players)) {
      const s = scores[uid] || (scores[uid] = { score: 0, correct: 0, time: 0, streak: 0 });
      const x = got[uid];
      if (!x) { s.streak = 0; perPlayer[uid] = [-1, 0]; continue; }
      if (x.a.choices) x.a.choices.forEach(c => { if (c >= 0 && c < counts.length) counts[c]++; });
      const ok = judge(q, x.a);
      if (ok) {
        const gain = Math.round(1000 * (1 - x.elapsed / dur / 2)); // 答對 500～1000 分，越快越高
        s.score += gain; s.correct++; s.time += x.elapsed; s.streak++;
        correctCount++;
        perPlayer[uid] = [1, gain];
      } else {
        s.streak = 0;
        perPlayer[uid] = [0, 0];
        if (q.input === 'text' && x.a.text) { const k = String(x.a.text).trim().slice(0, 30); wrong[k] = (wrong[k] || 0) + 1; }
      }
    }
    const results = {};
    ranking().forEach(([uid, s], i) => { results[uid] = [perPlayer[uid][0], perPlayer[uid][1], s.score, i + 1, s.streak, s.correct]; });
    const reveal = {
      answer: q.answer || [], accepted: q.accepted || [], explanation: q.explanation || '', counts, correctCount,
      answeredCount: Object.keys(got).length, totalPlayers: playerCount(),
      wrongTop: Object.entries(wrong).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([text, n]) => ({ text, n })),
      isLast: g.index >= questions.length - 1
    };
    await fb.update(gp(), { state: 'reveal', reveal, results });
    await fb.set(gp('/private/state'), { scores });
  } catch (e) { console.error(e); toast('寫入失敗，請檢查網路後再按一次'); }
  finally { busy = false; }
}

async function showLeaderboard() {
  const top = ranking().slice(0, 5).map(([uid, s], i) => ({ rank: i + 1, name: players[uid].name, score: s.score, streak: s.streak }));
  await fb.update(gp(), { state: 'leaderboard', top });
}

async function finish() {
  if (game.state === 'question') await endQuestion();
  if (game.state === 'final') return;
  const ranked = ranking();
  const top10 = ranked.slice(0, 10).map(([uid, s], i) => ({ rank: i + 1, name: players[uid].name, score: s.score, correctCount: s.correct }));
  await fb.update(gp(), { state: 'final', final: { top10, totalPlayers: ranked.length } });
  if (ranked.length) {
    await fb.set(`history/${pin}_${Date.now()}`, {
      pin, title: game.title, endedAt: fb.SERVER_TIME(), playerCount: ranked.length, questionCount: questions.length, top10
    }).catch(e => console.error(e));
  }
}

let acting = false;
const next = () => advance(false);
async function advance(auto) {
  if (busy || acting || !game) return;
  clearAuto();
  acting = true;
  $('#btn-next').disabled = true;
  const s = game.state;
  try {
    if (s === 'lobby') { if (questions.length) await startQuestion(0); }
    else if (s === 'question') await endQuestion();
    else if (s === 'reveal') {
      if (game.index >= questions.length - 1) await finish();
      else if (game.auto && !(game.boardSecs > 0)) await startQuestion(game.index + 1); // 排行榜秒數設 0 → 直接下一題
      else await showLeaderboard();
    }
    else if (s === 'leaderboard') await startQuestion(game.index + 1);
  } catch (e) { console.error(e); toast('操作失敗：' + (e.message || '請檢查網路')); }
  finally { acting = false; if (game && game.state !== 'lobby') $('#btn-next').disabled = false; else renderPlayers(); }
}

async function kick(uid) {
  const p = players[uid];
  if (!p) return;
  delete scores[uid];
  await fb.batch([{ op: 'delete', path: gp('/players/' + uid) }, { op: 'delete', path: gp('/names/' + p.name) }]).catch(e => toast('移除失敗'));
}

$('#btn-next').onclick = next;
$('#btn-finish').onclick = () => { if (confirm('確定要提早結束，直接公布最終排名嗎？')) finish().catch(e => toast('操作失敗')); };
document.addEventListener('keydown', e => {
  if ((e.key === ' ' || e.key === 'ArrowRight') && !$('#btn-next').disabled && e.target === document.body) { e.preventDefault(); next(); }
});
