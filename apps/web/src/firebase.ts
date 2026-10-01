import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

// Firebase web app identifiers are public. Firestore access remains Worker-only.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim() || 'AIzaSyDLKqHvC51dmWNrHOT_FApUjgyk4pxFipw',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || 'iseng-955ec.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || 'iseng-955ec',
  storageBucket: 'iseng-955ec.firebasestorage.app',
  messagingSenderId: '740147410928',
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim() || '1:740147410928:web:a5da5820d6120f3269cf35',
}

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId,
)

export const auth = firebaseConfigured
  ? getAuth(getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null
