// 學生手機端
import * as fb from './fb.js';

const pin = (new URLSearchParams(location.search).get('pin') || '').trim();
let uid = null, game = null, lastKey = '', seenMe = false, current = null, selected = new Set(), answering = false;
const unsubs = [];

const cd = new Countdown((left, total) => {
  const s = Math.ceil(left / 1000);
  $('#q-secs').textContent = s;
  $('#q-secs').classList.toggle('warn', s <= 5);
  $('#q-bar i').style.width = (left / total * 100) + '%';
  $('#q-bar').classList.toggle('warn', s <= 5);
}, () => { if (current) lockQuestion(); });

function show(id) { $$('section').forEach(s => s.classList.toggle('hidden', s.id !== id)); window.scrollTo(0, 0); }
const gp = p => `games/${pin}${p || ''}`;
const ansKey = i => `ans_${pin}_${i}`;

$('#pin').value = pin;
$('#name').value = localStorage.getItem('quiz_name') || '';

async function boot() {
  try { uid = await fb.signInAnon(); }
  catch (e) { toast('無法連線，請檢查網路後重新整理'); console.error(e); return; }
  if (!pin) return;
  try {
    const g = await fb.get(gp());
    if (!g) return toast('找不到這個遊戲代碼');
    $('#game-title').textContent = g.title;
    fb.get(gp('/theme/main')).then(applyTheme).catch(() => {});
    const me = await fb.get(gp('/players/' + uid));
    if (me) enterGame(me.name);
  } catch (e) { console.error(e); }
}
boot();

$('#btn-join').onclick = async () => {
  const p = $('#pin').value.trim();
  if (!p) return toast('請輸入遊戲代碼');
  if (p !== pin) { location.href = 'index.html?pin=' + encodeURIComponent(p); return; }
  const name = cleanName($('#name').value);
  if (!name) return toast('請輸入你的名稱');
  if (!uid) return toast('連線中，請稍等一下再按');
  $('#btn-join').disabled = true;
  try {
    const g = await fb.get(gp());
    if (!g) throw new Error('找不到這個遊戲代碼');
    if (g.state === 'final') throw new Error('這場遊戲已經結束囉');
    const me = await fb.get(gp('/players/' + uid));
    if (!me) {
      await fb.batch([
        { op: 'set', path: gp('/names/' + name), data: { uid } },
        { op: 'set', path: gp('/players/' + uid), data: { name, joinedAt: fb.SERVER_TIME() } }
      ]);
    }
    localStorage.setItem('quiz_name', name);
    enterGame(me ? me.name : name);
  } catch (e) {
    toast(fb.isPermissionError(e) ? '這個名稱有人用了，換一個吧！' : (e.message || '加入失敗'));
  } finally { $('#btn-join').disabled = false; }
};
$('#name').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });

function enterGame(name) {
  $('#me-name').textContent = '🎀 ' + name;
  show('s-lobby');
  unsubs.push(fb.listenDoc(gp('/players/' + uid), me => {
    if (me) seenMe = true;
    else if (seenMe) kicked('你被主持人移出遊戲了');
  }));
  unsubs.push(fb.listenDoc(gp(), (g, meta) => { if (g) render(g, meta); }, e => console.error(e)));
}

function kicked(msg) {
  cd.stop();
  unsubs.forEach(u => u());
  $('#k-msg').textContent = msg;
  show('s-kicked');
}

function render(g, meta) {
  const prevKey = lastKey;
  const key = g.state + ':' + g.index;
  game = g;
  lastKey = key;
  if (g.state === 'lobby') { show('s-lobby'); return; }
  if (g.state === 'question') {
    if (key === prevKey) return;
    if (localStorage.getItem(ansKey(g.index))) { $('#s-answered h2').textContent = '已送出！'; show('s-answered'); return; }
    const total = g.duration * 1000;
    const live = prevKey !== '' && !meta.fromCache; // 親眼看到題目切換 → 用完整秒數，不受手機時鐘誤差影響
    const remaining = live ? total : Math.max(0, Math.min(total, (g.qStartedAt || Date.now()) + total - Date.now()));
    showQuestion(g, remaining, total);
    return;
  }
  if (g.state === 'reveal' || g.state === 'leaderboard') { showResult(g); return; }
  if (g.state === 'final') showFinal(g);
}

function showQuestion(g, remaining, total) {
  const q = g.q;
  current = q; selected = new Set(); answering = false;
  $('#q-num').textContent = `第 ${g.index + 1} / ${g.total} 題`;
  $('#q-type').textContent = TYPE_LABEL[q.type];
  $('#q-type').className = 'tag ' + q.type;
  $('#q-text').textContent = q.text;
  const pas = $('#q-passage');
  pas.classList.toggle('hidden', !q.passage);
  $('div', pas).textContent = q.passage || '';
  const opts = $('#q-opts'); opts.innerHTML = '';
  $('#q-textbox').classList.toggle('hidden', q.input !== 'text');
  $('#q-submit').classList.toggle('hidden', !(q.multi || q.input === 'text'));
  $('#q-submit').disabled = false;
  if (q.input === 'text') {
    $('#q-hint').textContent = '✏️ 請直接打字作答';
    $('#q-input').value = '';
    setTimeout(() => $('#q-input').focus(), 200);
  } else {
    $('#q-hint').textContent = q.multi ? '✅ 可以選多個答案，選好後按送出' : '👆 點一個答案就送出';
    q.options.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'opt o' + i;
      b.innerHTML = `<span class="shape">${OPT_SHAPES[i]}</span><span>${esc(t)}</span>`;
      b.onclick = () => {
        if (answering) return;
        if (q.multi) { selected.has(i) ? selected.delete(i) : selected.add(i); b.classList.toggle('selected'); }
        else send({ choices: [i] });
      };
      opts.appendChild(b);
    });
  }
  show('s-question');
  cd.start(remaining, total);
  if (remaining <= 0) lockQuestion();
}

$('#q-submit').onclick = () => {
  if (!current) return;
  if (current.input === 'text') {
    const t = $('#q-input').value.trim();
    if (!t) return toast('請輸入答案');
    send({ text: t.slice(0, 200) });
  } else {
    if (!selected.size) return toast('請至少選一個答案');
    send({ choices: [...selected].sort((a, b) => a - b) });
  }
};
$('#q-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('#q-submit').click(); });

function send(payload) {
  if (answering || !game || game.state !== 'question') return;
  answering = true;
  const index = game.index;
  localStorage.setItem(ansKey(index), '1');
  cd.stop(); current = null;
  $('#s-answered h2').textContent = '已送出！';
  show('s-answered');
  fb.set(gp(`/answers/${index}_${uid}`), { uid, index, ...payload, at: fb.SERVER_TIME() }).catch(e => {
    if (fb.isPermissionError(e)) return; // 已經作答過
    console.error(e);
    localStorage.removeItem(ansKey(index));
    if (game && game.state === 'question' && game.index === index) {
      toast('送出失敗，請再試一次');
      lastKey = '';
      render(game, { fromCache: false });
    }
  });
}

function lockQuestion() {
  answering = true;
  $$('#q-opts .opt').forEach(b => b.classList.add('dim'));
  $('#q-submit').disabled = true;
  $('#q-hint').textContent = '⏰ 時間到！';
}

function correctText(g) {
  const q = g.q, rv = g.reveal || {};
  if (!q) return '';
  if (q.input === 'text') return (rv.accepted || []).join(' / ');
  return (rv.answer || []).map(i => LETTERS[i] + '. ' + q.options[i]).join('、');
}

function showResult(g) {
  cd.stop(); current = null;
  const r = g.results && g.results[uid];
  if (!r) { show('s-answered'); $('#s-answered h2').textContent = '等待下一題'; return; }
  const [c, gain, score, rank, streak] = r;
  const card = $('#r-card');
  if ($('#s-result').classList.contains('hidden') || card.dataset.key !== String(g.index)) {
    card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
  }
  card.dataset.key = String(g.index);
  card.classList.remove('ok-card', 'bad-card');
  if (c === 1) {
    card.classList.add('ok-card');
    $('#r-emoji').textContent = streak >= 3 ? '🔥' : '🎉';
    $('#r-title').textContent = streak >= 2 ? `答對了！連對 ${streak} 題` : '答對了！';
    $('#r-gain').textContent = '+' + gain;
  } else {
    card.classList.add('bad-card');
    $('#r-emoji').textContent = c === 0 ? '😵' : '⏰';
    $('#r-title').textContent = c === 0 ? '差一點點！' : '沒有作答';
    $('#r-gain').textContent = '+0';
  }
  const ct = correctText(g);
  $('#r-answer').textContent = ct ? '正確答案：' + ct : '';
  $('#r-rank').textContent = `目前第 ${rank} 名 · ${score} 分`;
  $('#r-total').textContent = `共 ${Object.keys(g.results).length} 位同學`;
  show('s-result');
}

let finalShown = false;
function showFinal(g) {
  cd.stop();
  const r = g.results && g.results[uid];
  const rank = r ? r[3] : 0, score = r ? r[2] : 0, correct = r ? r[5] : 0;
  const totalPlayers = g.final ? g.final.totalPlayers : Object.keys(g.results || {}).length;
  const medal = ['🥇', '🥈', '🥉'][rank - 1];
  $('#f-emoji').textContent = medal || (rank && rank <= 10 ? '🌟' : '💖');
  $('#f-title').textContent = !rank ? '遊戲結束！' : medal ? `恭喜！你是第 ${rank} 名！` : rank <= 10 ? `太棒了！第 ${rank} 名` : `你是第 ${rank} 名，辛苦了！`;
  $('#f-score').textContent = score + ' 分';
  $('#f-detail').textContent = `答對 ${correct} / ${g.total} 題 · 共 ${totalPlayers} 人參加`;
  show('s-final');
  if (!finalShown && rank && rank <= 3) confetti();
  finalShown = true;
}
