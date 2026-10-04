// Public Firebase web app identifiers. Access is controlled by Google sign-in
// and the Firestore rules, not by keeping this configuration secret.
window.SING_IT_AGAIN_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCBXvEOx7Z8Dod00u4-EJujdKf7GoOdg0w",
  authDomain: "sing-it-again-199b0.firebaseapp.com",
  projectId: "sing-it-again-199b0",
  storageBucket: "sing-it-again-199b0.firebasestorage.app",
  messagingSenderId: "735976981583",
  appId: "1:735976981583:web:d26f7c32c2ee9db74bd63a"
};

// Feature modules can be shipped independently of the main app shell. This keeps
// the shared performance archive isolated while it is tested on the feature branch.
const performanceFeedback = document.createElement('script');
performanceFeedback.type = 'module';
performanceFeedback.src = 'src/performance-feedback.js?v=1';
document.head.appendChild(performanceFeedback);
