// Firebase 介面層：其他程式只透過這裡存取 Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  getAuth, signInAnonymously, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut as fbSignOut
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {
  initializeFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, orderBy,
  limit as qLimit, onSnapshot, writeBatch, runTransaction, serverTimestamp, deleteField, Timestamp
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

export const SERVER_TIME = () => serverTimestamp();
export const DELETE = () => deleteField();
export { ADMIN_EMAILS };

// Timestamp → 毫秒數字（深層轉換）
function plain(v) {
  if (v instanceof Timestamp) return v.toMillis();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = plain(v[k]); return o; }
  return v;
}
const snapData = s => (s.exists() ? plain(s.data({ serverTimestamps: 'estimate' })) : null);
const ref = path => doc(db, path);

// ---------- 登入 ----------
export function onUser(cb) { return onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email, anonymous: u.isAnonymous } : null)); }
export async function signInAnon() { const r = await signInAnonymously(auth); return r.user.uid; }
export async function signInGoogle() { await signInWithPopup(auth, new GoogleAuthProvider()); }
export async function signOut() { await fbSignOut(auth); }
export function currentUid() { return auth.currentUser ? auth.currentUser.uid : null; }

// ---------- 文件 ----------
export async function get(path) { return snapData(await getDoc(ref(path))); }
export async function set(path, data, merge = false) { await setDoc(ref(path), data, { merge }); }
export async function update(path, data) { await updateDoc(ref(path), data); }
export async function del(path) { await deleteDoc(ref(path)); }
export async function list(collPath, { order, desc = false, max, whereEq } = {}) {
  const parts = [];
  if (whereEq) parts.push(where(whereEq[0], '==', whereEq[1]));
  if (order) parts.push(orderBy(order, desc ? 'desc' : 'asc'));
  if (max) parts.push(qLimit(max));
  const snap = await getDocs(query(collection(db, collPath), ...parts));
  return snap.docs.map(d => ({ id: d.id, ...plain(d.data()) }));
}
export async function listOlderThan(collPath, field, millis) {
  const snap = await getDocs(query(collection(db, collPath), where(field, '<', Timestamp.fromMillis(millis))));
  return snap.docs.map(d => ({ id: d.id, ...plain(d.data()) }));
}

// 監聽單一文件：cb(data|null, { fromCache, pending })
export function listenDoc(path, cb, onErr) {
  return onSnapshot(ref(path), { includeMetadataChanges: false },
    s => cb(snapData(s), { fromCache: s.metadata.fromCache, pending: s.metadata.hasPendingWrites }),
    e => onErr && onErr(e));
}
// 監聽集合（可加 where 欄位 == 值）：cb([{id, ...data}])
export function listenColl(collPath, cb, whereEq, onErr) {
  const q = whereEq ? query(collection(db, collPath), where(whereEq[0], '==', whereEq[1])) : collection(db, collPath);
  return onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...plain(d.data({ serverTimestamps: 'estimate' })) }))), e => onErr && onErr(e));
}

// 批次：[{ op: 'set'|'update'|'delete', path, data }]
export async function batch(ops) {
  for (let i = 0; i < ops.length; i += 450) {
    const b = writeBatch(db);
    for (const o of ops.slice(i, i + 450)) {
      if (o.op === 'set') b.set(ref(o.path), o.data);
      else if (o.op === 'update') b.update(ref(o.path), o.data);
      else if (o.op === 'delete') b.delete(ref(o.path));
    }
    await b.commit();
  }
}
// 文件不存在才建立；成功回傳 true
export async function createIfAbsent(path, data) {
  return runTransaction(db, async tx => {
    const s = await tx.get(ref(path));
    if (s.exists()) return false;
    tx.set(ref(path), data);
    return true;
  });
}
export const isPermissionError = e => e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''));
