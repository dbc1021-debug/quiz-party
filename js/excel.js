// Excel 題目解析（使用 SheetJS，於 admin.html 由 CDN 載入，全域變數 XLSX）
const LETTERS_ = 'ABCDEF';
const TYPE_MAP = {
  '單選': 'single', '單選題': 'single', '單一選擇': 'single', '單一選擇題': 'single', '選擇': 'single', '選擇題': 'single',
  '多選': 'multi', '多選題': 'multi', '複選': 'multi', '複選題': 'multi',
  '素養': 'literacy', '素養題': 'literacy', '閱讀素養': 'literacy',
  '翻譯': 'translation', '翻譯題': 'translation'
};

function detectColumns(row) {
  const cols = { options: {} };
  row.forEach((cell, col) => {
    const h = String(cell || '').replace(/\s/g, '').normalize('NFKC');
    if (!h) return;
    const opt = h.match(/^(?:選項)?([A-Fa-f])$/);
    if (opt) { cols.options[opt[1].toUpperCase()] = col; return; }
    if (h.includes('題型') || h.includes('類型')) cols.type = col;
    else if (h.includes('文本') || h.includes('閱讀') || h.includes('題組') || h.includes('情境')) cols.passage = col;
    else if (h.includes('答案')) cols.answer = col;
    else if (h.includes('秒') || h.includes('時間')) cols.time = col;
    else if (h.includes('解析') || h.includes('詳解')) cols.explanation = col;
    else if (h.includes('題目') || h.includes('問題') || h.includes('題幹')) cols.text = col;
  });
  return cols;
}

function parseChoiceAnswer(raw, rawOptions) {
  const s = raw.normalize('NFKC').toUpperCase();
  const byText = rawOptions.find(o => o.text.normalize('NFKC').toUpperCase() === s);
  if (byText && !/^[A-F,、\s]+$/.test(s)) return [byText.letter];
  let letters = s.match(/[A-F]/g) || [];
  if (!letters.length) letters = (s.match(/[1-6]/g) || []).map(n => LETTERS_[Number(n) - 1]);
  return [...new Set(letters)];
}

function parseWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const questions = [], errors = [];
  let rows = null, headerIdx = -1, cols = null;
  for (const name of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false, blankrows: true });
    for (let i = 0; i < Math.min(6, r.length); i++) {
      const c = detectColumns(r[i]);
      if (c.type != null && c.text != null) { rows = r; headerIdx = i; cols = c; break; }
    }
    if (rows) break;
  }
  if (!rows) {
    errors.push({ row: 0, msg: '找不到標題列（需要至少有「題型」和「題目」欄位）。請下載範本對照。' });
    return { questions, errors };
  }
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i], r = i + 1;
    const get = c => (c == null ? '' : String(row[c] == null ? '' : row[c]).trim());
    const typeRaw = get(cols.type).replace(/\s/g, '');
    const text = get(cols.text);
    const rawOptions = LETTERS_.split('').map(L => ({ letter: L, text: get(cols.options[L]) })).filter(o => o.text);
    const answerRaw = get(cols.answer);
    if (!typeRaw && !text && !rawOptions.length && !answerRaw) continue;

    const type = TYPE_MAP[typeRaw];
    if (!type) { errors.push({ row: r, msg: `題型「${typeRaw || '空白'}」看不懂，請填 單選／多選／素養／翻譯` }); continue; }
    if (!text) { errors.push({ row: r, msg: '題目是空的' }); continue; }
    const q = {
      type, text: text.slice(0, 500), passage: get(cols.passage).slice(0, 2000), explanation: get(cols.explanation).slice(0, 500),
      options: [], answer: [], accepted: [], multi: false, input: 'choice', time: null
    };
    const t = parseInt(get(cols.time), 10);
    if (Number.isFinite(t) && t >= 5 && t <= 600) q.time = t;

    if (type === 'translation' && rawOptions.length < 2) {
      q.input = 'text';
      q.accepted = answerRaw.split(/[|｜／/;；\n]/).map(s => s.trim()).filter(Boolean).slice(0, 10);
      if (!q.accepted.length) { errors.push({ row: r, msg: '翻譯題（打字作答）需要在「正確答案」填入答案，多個答案用 | 分隔' }); continue; }
      questions.push(q); continue;
    }
    if (rawOptions.length < 2) { errors.push({ row: r, msg: '選擇題至少需要 2 個選項' }); continue; }
    const letters = parseChoiceAnswer(answerRaw, rawOptions);
    const idx = letters.map(L => rawOptions.findIndex(o => o.letter === L)).filter(x => x >= 0);
    if (!idx.length) { errors.push({ row: r, msg: `正確答案「${answerRaw || '空白'}」對不到任何選項` }); continue; }
    if (type === 'single' && idx.length !== 1) { errors.push({ row: r, msg: '單選題只能有一個正確答案（若要多個請改成多選）' }); continue; }
    q.options = rawOptions.map(o => o.text.slice(0, 200));
    q.answer = idx.sort((a, b) => a - b);
    q.multi = type === 'multi' || idx.length > 1;
    questions.push(q);
  }
  return { questions, errors };
}

