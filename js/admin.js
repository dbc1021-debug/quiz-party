// 後台（Firebase 版）
import * as fb from './fb.js';

const BUILTIN_THEMES = [
  { id: 'strawberry', name: '草莓牛奶 🍓', builtIn: true, colors: { bg: '#ffe3ec', bg2: '#ffc2d6', primary: '#ff5c8d', accent: '#ffb84d', text: '#5a2a3c', card: '#ffffff' }, bgImage: '', mascot: '' },
  { id: 'mint', name: '薄荷蘇打 🍃', builtIn: true, colors: { bg: '#dcfaf0', bg2: '#b5ecdf', primary: '#21b58f', accent: '#ff8fab', text: '#1f4a42', card: '#ffffff' }, bgImage: '', mascot: '' },
  { id: 'pudding', name: '檸檬布丁 🍮', builtIn: true, colors: { bg: '#fff6d6', bg2: '#ffe59e', primary: '#f59f00', accent: '#7c6cf2', text: '#5c4310', card: '#ffffff' }, bgImage: '', mascot: '' },
  { id: 'dreamy', name: '夢幻棉花糖 ☁️', builtIn: true, colors: { bg: '#ece6ff', bg2: '#d3e4ff', primary: '#8c6cf0', accent: '#ff7eb6', text: '#3b2f66', card: '#ffffff' }, bgImage: '', mascot: '' }
];
const MAX = 50;
const S = { imports: [], questions: [], themes: [], quizzes: [], selected: [], editingQuizId: null, user: null };
const rid = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join('');
const bytes = o => new TextEncoder().encode(JSON.stringify(o)).length;
const fmtTime = t => (t ? new Date(t).toLocaleString('zh-TW') : '');

// ---------- 登入 ----------
$('#btn-login').onclick = () => fb.signInGoogle().catch(e => toast('登入失敗：' + e.message));
$('#btn-logout').onclick = () => fb.signOut();
fb.onUser(async u => {
  S.user = u;
  const ok = u && !u.anonymous && fb.ADMIN_EMAILS.map(e => e.toLowerCase()).includes(String(u.email || '').toLowerCase());
  $('#login').classList.toggle('hidden', !!ok);
  $('#app').classList.toggle('hidden', !ok);
  $('#login-msg').textContent = u && !u.anonymous && !ok ? `「${u.email}」沒有後台權限，請改用 firebase-config.js 裡設定的帳號。` : '';
  $('#btn-logout-2').classList.toggle('hidden', !(u && !u.anonymous && !ok));
  if (ok) { $('#who').textContent = u.email; await loadAll().catch(handleErr); }
});
$('#btn-logout-2').onclick = () => fb.signOut();
function handleErr(e) {
  console.error(e);
  toast(fb.isPermissionError(e) ? '沒有權限：請確認 firestore.rules 裡的 Email 是否正確' : '發生錯誤：' + (e.message || e));
}

// ---------- 分頁 ----------
$$('.tabs button').forEach(b => b.onclick = () => {
  $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('#app > section').forEach(s => s.classList.toggle('hidden', s.id !== b.dataset.tab));
  if (b.dataset.tab === 't-history') loadHistory().catch(handleErr);
});

async function loadAll() {
  const [imports, themes, quizzes] = await Promise.all([
    fb.list('imports', { order: 'createdAt', desc: true }), fb.list('themes', { order: 'createdAt' }), fb.list('quizzes', { order: 'updatedAt', desc: true })
  ]);
  S.imports = imports;
  S.questions = imports.flatMap(imp => (imp.questions || []).map(q => ({ ...q, id: imp.id + '.' + q.qid, importId: imp.id, category: imp.category })));
  S.themes = [...BUILTIN_THEMES, ...themes];
  S.quizzes = quizzes;
  const byId = new Map(S.questions.map(q => [q.id, q]));
  S.selected = S.selected.filter(s => byId.has(s.q.id)).map(s => ({ q: byId.get(s.q.id), time: s.time }));
  renderFilters(); renderQList(); renderSelected(); renderThemes(); renderImports(); renderQuizzes();
}

// ---------- 選題 ----------
function renderFilters() {
  const cats = [...new Set(S.imports.map(i => i.category))];
  const keep = (sel, html) => { const v = sel.value; sel.innerHTML = html; sel.value = v; };
  keep($('#f-cat'), '<option value="">全部分類</option>' + cats.map(c => `<option>${esc(c)}</option>`).join(''));
  keep($('#f-imp'), '<option value="">全部匯入批次</option>' + S.imports.map(i => `<option value="${i.id}">${esc(i.name)}（${esc(i.category)}）</option>`).join(''));
  $('#cat-list').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  keep($('#g-theme'), S.themes.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join(''));
  if (!$('#g-theme').value && S.themes[0]) $('#g-theme').value = S.themes[0].id;
}
['#f-cat', '#f-imp', '#f-type'].forEach(s => $(s).onchange = renderQList);
$('#f-q').oninput = renderQList;

function filtered() {
  const cat = $('#f-cat').value, imp = $('#f-imp').value, type = $('#f-type').value, k = $('#f-q').value.trim().toLowerCase();
  return S.questions.filter(q => (!cat || q.category === cat) && (!imp || q.importId === imp) && (!type || q.type === type) &&
    (!k || (q.text + q.passage + q.options.join(' ')).toLowerCase().includes(k)));
}
const isSel = id => S.selected.some(s => s.q.id === id);
const answerText = q => (q.input === 'text' ? '答：' + q.accepted.join(' / ') : '答：' + q.answer.map(i => LETTERS[i]).join(','));

function renderQList() {
  const list = filtered();
  $('#q-total').textContent = `（列出 ${list.length} / 共 ${S.questions.length} 題）`;
  const impName = Object.fromEntries(S.imports.map(i => [i.id, i.name]));
  $('#qlist').innerHTML = list.length ? list.map(q => `
    <div class="qi ${isSel(q.id) ? 'on' : ''}" data-id="${q.id}">
      <input type="checkbox" ${isSel(q.id) ? 'checked' : ''}>
      <div class="t">
        <div><span class="tag ${q.type}">${TYPE_LABEL[q.type]}</span> <span class="txt">${esc(q.text)}</span></div>
        <div class="sub">${esc(q.category)} · ${esc(impName[q.importId] || '')} · ${q.input === 'text' ? '打字作答' : q.options.length + ' 個選項' + (q.multi ? '（複選）' : '')} · ${esc(answerText(q))}${q.time ? ' · ' + q.time + ' 秒' : ''}</div>
      </div>
    </div>`).join('') : '<p class="muted">沒有題目，先到「題庫與匯入」上傳 Excel 吧！</p>';
  $$('#qlist .qi').forEach(el => el.onclick = () => toggleQ(el.dataset.id));
}
function defTime() { return Math.min(600, Math.max(5, parseInt($('#all-secs').value, 10) || 20)); }
function toggleQ(id) {
  const i = S.selected.findIndex(s => s.q.id === id);
  if (i >= 0) S.selected.splice(i, 1);
  else {
    if (S.selected.length >= MAX) return toast(`最多只能選 ${MAX} 題`);
    const q = S.questions.find(x => x.id === id);
    S.selected.push({ q, time: q.time || defTime() });
  }
  renderQList(); renderSelected();
}
$('#btn-add-all').onclick = () => {
  let added = 0;
  for (const q of filtered()) {
    if (S.selected.length >= MAX) { toast(`已達上限 ${MAX} 題`); break; }
    if (!isSel(q.id)) { S.selected.push({ q, time: q.time || defTime() }); added++; }
  }
  if (added) toast(`加入了 ${added} 題`);
  renderQList(); renderSelected();
};
function renderSelected() {
  $('#sel-count').textContent = `${S.selected.length} / ${MAX}`;
  const box = $('#sel-list');
  box.innerHTML = S.selected.length ? S.selected.map((s, i) => `
    <div class="sel">
      <span class="n">${i + 1}</span>
      <span class="tag ${s.q.type}">${TYPE_LABEL[s.q.type].slice(0, 2)}</span>
      <span class="txt" title="${esc(s.q.text)}">${esc(s.q.text)}</span>
      <input type="number" min="5" max="600" value="${s.time}" data-i="${i}" title="秒數"> 秒
      <button class="icon" data-up="${i}" title="上移">⬆</button>
      <button class="icon" data-down="${i}" title="下移">⬇</button>
      <button class="icon" data-rm="${i}" title="移除">✕</button>
    </div>`).join('') : '<p class="muted">從左邊點題目加入（最多 50 題）</p>';
  $$('input[data-i]', box).forEach(inp => inp.onchange = () => {
    const s = S.selected[inp.dataset.i];
    s.time = Math.min(600, Math.max(5, parseInt(inp.value, 10) || 20));
    inp.value = s.time; updateTime();
  });
  $$('[data-up]', box).forEach(b => b.onclick = () => move(+b.dataset.up, -1));
  $$('[data-down]', box).forEach(b => b.onclick = () => move(+b.dataset.down, 1));
  $$('[data-rm]', box).forEach(b => b.onclick = () => { S.selected.splice(+b.dataset.rm, 1); renderQList(); renderSelected(); });
  updateTime();
}
function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= S.selected.length) return;
  [S.selected[i], S.selected[j]] = [S.selected[j], S.selected[i]];
  renderSelected();
}
function updateTime() {
  const sec = S.selected.reduce((a, s) => a + s.time, 0);
  $('#sel-time').textContent = S.selected.length ? `作答時間合計約 ${Math.floor(sec / 60)} 分 ${sec % 60} 秒（不含公布答案時間）` : '';
}
$('#btn-apply-all').onclick = () => { const t = defTime(); S.selected.forEach(s => s.time = t); renderSelected(); };
$('#btn-use-excel').onclick = () => { const t = defTime(); S.selected.forEach(s => s.time = s.q.time || t); renderSelected(); };
$('#btn-clear').onclick = () => { S.selected = []; S.editingQuizId = null; renderQList(); renderSelected(); };
const items = () => S.selected.map(s => ({ id: s.q.id, time: s.time }));
const clampN = (v, lo, hi, d) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
function autoSettings() {
  return { auto: $('#g-auto').checked, revealSecs: clampN($('#g-reveal').value, 2, 60, 5), boardSecs: clampN($('#g-board').value, 0, 60, 5) };
}
$('#g-auto').onchange = () => $('#auto-opts').classList.toggle('hidden', !$('#g-auto').checked);

// ---------- 開始遊戲 ----------
$('#btn-start').onclick = async () => {
  if (!S.selected.length) return toast('請先選題目');
  const w = window.open('about:blank', '_blank');
  $('#btn-start').disabled = true;
  try {
    let list = S.selected.map(s => {
      const { id, importId, category, qid, ...q } = s.q;
      return { ...q, time: s.time };
    });
    if ($('#g-shuffle').checked) {
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    }
    if (bytes(list) > 900000) throw new Error('選的題目內容太多（超過資料庫單筆上限），請減少題數或縮短閱讀文本');
    const theme = S.themes.find(t => t.id === $('#g-theme').value) || BUILTIN_THEMES[0];
    const title = $('#g-title').value.trim().slice(0, 60) || '搶答派對';
    const auto = autoSettings();
    let pin = null;
    for (let k = 0; k < 8 && !pin; k++) {
      const p = String(100000 + Math.floor(Math.random() * 900000));
      if (await fb.createIfAbsent(`games/${p}`, { title, state: 'lobby', index: -1, total: list.length, createdAt: fb.SERVER_TIME(), hostUid: S.user.uid, ...auto })) pin = p;
    }
    if (!pin) throw new Error('建立遊戲代碼失敗，請再試一次');
    await fb.batch([
      { op: 'set', path: `games/${pin}/theme/main`, data: { name: theme.name, colors: theme.colors, bgImage: theme.bgImage || '', mascot: theme.mascot || '' } },
      { op: 'set', path: `games/${pin}/private/questions`, data: { list } },
      { op: 'set', path: `games/${pin}/private/state`, data: { scores: {} } }
    ]);
    const url = `host.html?pin=${pin}`;
    if (w) w.location = url; else location.href = url;
  } catch (e) { if (w) w.close(); handleErr(e); }
  finally { $('#btn-start').disabled = false; }
};

// ---------- 測驗組合 ----------
$('#btn-save-quiz').onclick = async () => {
  if (!S.selected.length) return toast('請先選題目');
  const current = S.quizzes.find(z => z.id === S.editingQuizId);
  const name = prompt('測驗組合名稱：', $('#g-title').value || (current && current.name) || '');
  if (name === null) return;
  let id = null;
  if (current && confirm(`要覆蓋原本的「${current.name}」嗎？\n按「取消」會另存新的一份。`)) id = current.id;
  id = id || rid();
  try {
    await fb.set(`quizzes/${id}`, { name: name.trim().slice(0, 60) || '未命名測驗', items: items(), themeId: $('#g-theme').value, shuffle: $('#g-shuffle').checked, ...autoSettings(), updatedAt: fb.SERVER_TIME() });
    S.editingQuizId = id;
    S.quizzes = await fb.list('quizzes', { order: 'updatedAt', desc: true });
    renderQuizzes(); toast('已儲存 💾');
  } catch (e) { handleErr(e); }
};
function renderQuizzes() {
  const box = $('#quiz-list');
  if (!S.quizzes.length) { box.innerHTML = '<span class="muted">還沒有，選好題目後按「儲存成測驗組合」</span>'; return; }
  box.innerHTML = '<table>' + S.quizzes.map(z => `
    <tr><td><b>${esc(z.name)}</b><div class="muted">${z.items.length} 題 · ${fmtTime(z.updatedAt)}</div></td>
    <td style="text-align:right;white-space:nowrap"><button class="btn small" data-load="${z.id}">載入</button>
    <button class="btn small danger" data-del="${z.id}">刪除</button></td></tr>`).join('') + '</table>';
  $$('[data-load]', box).forEach(b => b.onclick = () => {
    const z = S.quizzes.find(x => x.id === b.dataset.load);
    const byId = new Map(S.questions.map(q => [q.id, q]));
    S.selected = z.items.filter(it => byId.has(it.id)).map(it => ({ q: byId.get(it.id), time: it.time }));
    S.editingQuizId = z.id;
    $('#g-title').value = z.name;
    if (S.themes.some(t => t.id === z.themeId)) $('#g-theme').value = z.themeId;
    $('#g-shuffle').checked = !!z.shuffle;
    if (z.auto !== undefined) {
      $('#g-auto').checked = !!z.auto; $('#g-reveal').value = z.revealSecs ?? 5; $('#g-board').value = z.boardSecs ?? 5;
      $('#auto-opts').classList.toggle('hidden', !z.auto);
    }
    renderQList(); renderSelected();
    toast(S.selected.length < z.items.length ? `已載入（有 ${z.items.length - S.selected.length} 題已被刪除）` : `已載入「${z.name}」`);
  });
  $$('[data-del]', box).forEach(b => b.onclick = async () => {
    if (!confirm('確定刪除這個測驗組合？（題目本身不會被刪）')) return;
    try { await fb.del('quizzes/' + b.dataset.del); S.quizzes = S.quizzes.filter(z => z.id !== b.dataset.del); renderQuizzes(); } catch (e) { handleErr(e); }
  });
}

// ---------- 匯入 ----------
$('#btn-import').onclick = async () => {
  const f = $('#imp-file').files[0];
  if (!f) return toast('請選擇 Excel 檔');
  if (!/\.xlsx$/i.test(f.name)) return toast('只支援 .xlsx 檔（舊版 .xls 請先另存新檔為 .xlsx）');
  if (typeof XLSX === 'undefined') return toast('Excel 解析元件載入失敗，請檢查網路後重新整理');
  const out = $('#imp-result');
  $('#btn-import').disabled = true;
  try {
    const { questions, errors } = parseWorkbook(await f.arrayBuffer());
    if (!questions.length) { out.innerHTML = '<p class="err">❌ 沒有讀到任何可用的題目</p>' + errHtml(errors); return; }
    const category = $('#imp-cat').value.trim().slice(0, 40) || '未分類';
    const baseName = $('#imp-name').value.trim().slice(0, 60) || f.name.replace(/\.xlsx$/i, '');
    // 每筆資料庫文件上限 1MB，題目太多時自動分成幾批
    const chunks = [[]];
    questions.forEach((q, i) => {
      const item = { ...q, qid: 'q' + i };
      const cur = chunks[chunks.length - 1];
      if (cur.length && bytes([...cur, item]) > 800000) chunks.push([item]); else cur.push(item);
    });
    const now = Date.now();
    await fb.batch(chunks.map((qs, i) => ({
      op: 'set', path: `imports/${rid()}`,
      data: {
        name: chunks.length > 1 ? `${baseName}（${i + 1}/${chunks.length}）` : baseName, category, fileName: f.name,
        createdAt: fb.SERVER_TIME(), order: now + i, errorCount: errors.length, questions: qs
      }
    })));
    out.innerHTML = `<p>✅ 成功匯入 <b>${questions.length}</b> 題到「${esc(category)}」</p>` + errHtml(errors);
    $('#imp-file').value = ''; $('#imp-name').value = '';
    await loadAll();
  } catch (e) {
    console.error(e);
    out.innerHTML = `<p class="err">❌ ${esc(fb.isPermissionError(e) ? '沒有寫入權限，請檢查 firestore.rules' : e.message || '無法讀取檔案')}</p>`;
  } finally { $('#btn-import').disabled = false; }
};
function errHtml(errs) {
  if (!errs || !errs.length) return '';
  return `<details open><summary class="err">有 ${errs.length} 列沒有匯入（點開看原因）</summary><ul class="err">${errs.map(e => `<li>${e.row ? '第 ' + e.row + ' 列：' : ''}${esc(e.msg)}</li>`).join('')}</ul></details>`;
}
function renderImports() {
  const box = $('#imp-list');
  if (!S.imports.length) { box.innerHTML = '<p class="muted">還沒有匯入紀錄</p>'; return; }
  box.innerHTML = '<table><tr><th>名稱 / 分類</th><th>題型</th><th>時間</th><th></th></tr>' + S.imports.map(i => {
    const types = {};
    (i.questions || []).forEach(q => { types[q.type] = (types[q.type] || 0) + 1; });
    return `<tr>
      <td><b>${esc(i.name)}</b><div class="muted">📂 ${esc(i.category)} · ${esc(i.fileName)}</div></td>
      <td>${Object.entries(types).map(([t, n]) => `<span class="tag ${t}">${TYPE_LABEL[t].slice(0, 2)} ${n}</span>`).join(' ')}<div class="muted">共 ${(i.questions || []).length} 題</div></td>
      <td class="muted">${fmtTime(i.createdAt)}</td>
      <td style="white-space:nowrap">
        <button class="btn small ghost" data-view="${i.id}">看題目</button>
        <button class="btn small ghost" data-cat="${i.id}">改分類</button>
        <button class="btn small danger" data-del="${i.id}">刪除</button>
      </td></tr>`;
  }).join('') + '</table>';
  $$('[data-view]', box).forEach(b => b.onclick = () => {
    $('#f-imp').value = b.dataset.view; $('#f-cat').value = ''; $('#f-type').value = ''; $('#f-q').value = '';
    $('[data-tab="t-game"]').click(); renderQList();
  });
  $$('[data-cat]', box).forEach(b => b.onclick = async () => {
    const imp = S.imports.find(x => x.id === b.dataset.cat);
    const c = prompt('新的分類名稱：', imp.category);
    if (!c || !c.trim()) return;
    try { await fb.update('imports/' + imp.id, { category: c.trim().slice(0, 40) }); await loadAll(); } catch (e) { handleErr(e); }
  });
  $$('[data-del]', box).forEach(b => b.onclick = async () => {
    const imp = S.imports.find(x => x.id === b.dataset.del);
    if (!confirm(`確定刪除「${imp.name}」和裡面的 ${(imp.questions || []).length} 題？\n已存的測驗組合也會移除這些題目，無法復原。`)) return;
    try {
      const prefix = imp.id + '.';
      const ops = [{ op: 'delete', path: 'imports/' + imp.id }];
      S.quizzes.forEach(z => {
        if (z.items.some(it => it.id.startsWith(prefix))) ops.push({ op: 'update', path: 'quizzes/' + z.id, data: { items: z.items.filter(it => !it.id.startsWith(prefix)) } });
      });
      await fb.batch(ops);
      await loadAll(); toast('已刪除');
    } catch (e) { handleErr(e); }
  });
}

// ---------- 風格 ----------
function renderThemes() {
  $('#theme-list').innerHTML = S.themes.map(t => `
    <div class="tcard">
      <div class="tprev" style="background:${t.bgImage ? `url('${t.bgImage}') center/cover` : `linear-gradient(160deg,${t.colors.bg},${t.colors.bg2})`}">
        <img src="${t.mascot || 'img/mascot.svg'}" alt="">
        <span class="sw" style="background:${t.colors.primary}"></span><span class="sw" style="background:${t.colors.accent}"></span>
      </div>
      <div class="tb"><b>${esc(t.name)}</b>${t.builtIn ? '<span class="muted">內建</span>' : `<button class="btn small danger" data-tdel="${t.id}">刪除</button>`}</div>
    </div>`).join('');
  $$('[data-tdel]').forEach(b => b.onclick = async () => {
    if (!confirm('確定刪除這個風格？')) return;
    try { await fb.del('themes/' + b.dataset.tdel); await loadAll(); } catch (e) { handleErr(e); }
  });
}
// 圖片縮小壓縮成 dataURL（不需要 Firebase Storage）
function shrinkImage(file, maxSide, type, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL(type, quality));
    };
    img.onerror = () => reject(new Error('圖片讀取失敗'));
    img.src = URL.createObjectURL(file);
  });
}
const TH = ['bg', 'bg2', 'primary', 'accent', 'text', 'card'];
let prevBg = '', prevMascot = '';
function updatePreview() {
  const p = $('#th-prev');
  const v = k => $('#th-' + k).value;
  p.style.background = prevBg ? `url('${prevBg}') center/cover` : `linear-gradient(160deg,${v('bg')},${v('bg2')})`;
  $('.btn', p).style.background = v('primary');
  $('#th-prev-m').src = prevMascot || 'img/mascot.svg';
}
TH.forEach(k => $('#th-' + k).oninput = updatePreview);
$('#th-bgimg').onchange = async e => { prevBg = e.target.files[0] ? await shrinkImage(e.target.files[0], 1400, 'image/jpeg', 0.78) : ''; updatePreview(); };
$('#th-mascot').onchange = async e => { prevMascot = e.target.files[0] ? await shrinkImage(e.target.files[0], 360, 'image/webp', 0.85) : ''; updatePreview(); };
updatePreview();
$('#btn-theme').onclick = async () => {
  const colors = {};
  TH.forEach(k => { colors[k] = $('#th-' + k).value; });
  const data = { name: $('#th-name').value.trim().slice(0, 30) || '我的風格', colors, bgImage: prevBg, mascot: prevMascot, createdAt: fb.SERVER_TIME() };
  if (bytes(data) > 900000) return toast('圖片太大了，請換一張比較小的圖');
  try {
    const id = 'c' + rid();
    await fb.set('themes/' + id, data);
    toast(`已新增風格「${data.name}」`);
    $('#th-name').value = ''; $('#th-bgimg').value = ''; $('#th-mascot').value = '';
    prevBg = prevMascot = ''; updatePreview();
    await loadAll();
    $('#g-theme').value = id;
  } catch (e) { handleErr(e); }
};

// ---------- 歷史 ----------
async function loadHistory() {
  const list = await fb.list('history', { order: 'endedAt', desc: true, max: 100 });
  const box = $('#history');
  if (!list.length) { box.innerHTML = '<p class="muted">還沒有玩過的紀錄</p>'; return; }
  box.innerHTML = '<table><tr><th>時間</th><th>遊戲</th><th>人數</th><th>前三名</th><th></th></tr>' + list.map(g => `
    <tr>
      <td class="muted">${fmtTime(g.endedAt)}</td>
      <td><b>${esc(g.title)}</b><div class="muted">${g.questionCount} 題</div></td>
      <td>${g.playerCount}</td>
      <td class="history-top">
        ${g.top10.slice(0, 3).map((p, i) => `${['🥇', '🥈', '🥉'][i]} ${esc(p.name)}（${p.score}）`).join('<br>')}
        <details class="preview"><summary class="muted">看前 10 名</summary>${g.top10.map(p => `${p.rank}. ${esc(p.name)} — ${p.score} 分（答對 ${p.correctCount}）`).join('<br>')}</details>
      </td>
      <td><button class="btn small danger" data-hdel="${g.id}">刪除</button></td>
    </tr>`).join('') + '</table>';
  $$('[data-hdel]', box).forEach(b => b.onclick = async () => {
    if (!confirm('刪除這筆紀錄？')) return;
    try { await fb.del('history/' + b.dataset.hdel); loadHistory(); } catch (e) { handleErr(e); }
  });
}

// 清除一天前的遊戲資料（作答紀錄會佔空間）
$('#btn-cleanup').onclick = async () => {
  if (!confirm('要清除 1 天以前的遊戲資料嗎？（歷史排名紀錄會保留）\n資料很多時會花一點時間。')) return;
  $('#btn-cleanup').disabled = true;
  try {
    const old = await fb.listOlderThan('games', 'createdAt', Date.now() - 86400000);
    let n = 0;
    for (const g of old) {
      const ops = [];
      for (const sub of ['answers', 'players', 'names', 'theme', 'private']) {
        (await fb.list(`games/${g.id}/${sub}`)).forEach(d => ops.push({ op: 'delete', path: `games/${g.id}/${sub}/${d.id}` }));
      }
      ops.push({ op: 'delete', path: `games/${g.id}` });
      await fb.batch(ops);
      n++;
    }
    toast(n ? `已清除 ${n} 場遊戲的資料` : '沒有需要清除的資料');
  } catch (e) { handleErr(e); }
  finally { $('#btn-cleanup').disabled = false; }
};
