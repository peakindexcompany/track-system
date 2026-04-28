//lib/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
const firebaseConfig = {
  apiKey: "AIzaSyBSKptTd0lBWZ6hmTr_aJtZqUYFxkqizAo",
  authDomain: "peak-index-training-9423b.firebaseapp.com",
  projectId: "peak-index-training-9423b",
  storageBucket: "peak-index-training-9423b.firebasestorage.app",
  messagingSenderId: "667261293858",
  appId: "1:667261293858:web:6f5090168436cff172817b"
};
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);