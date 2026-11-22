// ⚠️ 請把這裡換成你自己 Firebase 專案的設定（Firebase 主控台 → 專案設定 → 一般 → 你的應用程式 → SDK 設定）
export const firebaseConfig = {
  apiKey: "請填入",
  authDomain: "你的專案.firebaseapp.com",
  projectId: "你的專案",
  storageBucket: "你的專案.appspot.com",
  messagingSenderId: "請填入",
  appId: "請填入"
};

// 可以登入後台的 Google 帳號（要和 firestore.rules 裡寫的一樣）
export const ADMIN_EMAILS = ["your.name@gmail.com"];
