const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** Firebase is optional: without config the app runs in "this browser only" mode. */
export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

/** Loaded on demand so the first paint doesn't wait for the Firebase SDK. */
export const fb = () => import("./firebase");
