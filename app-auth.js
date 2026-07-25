/* ============================================================
   APP-AUTH.JS — shared Firebase auth/role logic for every page.

   Load order on every page that uses this file:
     1. firebase-app-compat.js
     2. firebase-auth-compat.js
     3. firebase-firestore-compat.js
     4. firebase-config.js
     5. app-auth.js   (this file)
     6. (page-specific script)
   ============================================================ */

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const AppAuth = {
  // Where each role lands after logging in.
  ROLE_PAGES: {
    student: 'student-dashboard.html',
    teacher: 'teacher-dashboard.html'
  },

  /** Create a brand-new account and its profile document. */
  async signUp(fullName, email, password, role) {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: fullName });
    await db.collection('users').doc(cred.user.uid).set({
      name: fullName,
      email: email,
      role: role,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { user: cred.user, role };
  },

  /** Sign in an existing user and look up their stored role. */
  async signIn(email, password, rememberMe) {
    await auth.setPersistence(
      rememberMe ? firebase.auth.Auth.Persistence.LOCAL
                 : firebase.auth.Auth.Persistence.SESSION
    );
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const snap = await db.collection('users').doc(cred.user.uid).get();
    const role = snap.exists ? snap.data().role : 'student';
    return { user: cred.user, role };
  },

  resetPassword(email) {
    return auth.sendPasswordResetEmail(email);
  },

  redirectToDashboard(role) {
    (window.top || window).location.href = this.ROLE_PAGES[role] || this.ROLE_PAGES.student;
  },

  signOutUser() {
    return auth.signOut().then(() => { (window.top || window).location.href = 'index.html'; });
  },

  /**
   * Call on protected pages. If nobody is logged in, bounces to
   * index.html. If requiredRole is given and doesn't match the
   * user's stored role, bounces to that user's *own* dashboard
   * instead of showing them someone else's.
   *
   * Also auto-fills any element with [data-user-name] / [data-user-role]
   * and wires up any element with [data-logout] to sign out.
   */
  protectPage(requiredRole) {
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        (window.top || window).location.href = 'index.html';
        return;
      }

      let role = 'student';
      try {
        const snap = await db.collection('users').doc(user.uid).get();
        if (snap.exists) role = snap.data().role;
      } catch (err) {
        console.error('Could not load user profile:', err);
      }

      if (requiredRole && role !== requiredRole) {
        (window.top || window).location.href = this.ROLE_PAGES[role] || 'index.html';
        return;
      }

      document.querySelectorAll('[data-user-name]').forEach(el => {
        el.textContent = user.displayName || user.email;
      });
      document.querySelectorAll('[data-user-role]').forEach(el => {
        el.textContent = role.toUpperCase();
      });
      document.querySelectorAll('[data-logout]').forEach(el => {
        el.addEventListener('click', (e) => { e.preventDefault(); AppAuth.signOutUser(); });
      });
    });
  },

  /** Friendly text for common Firebase Auth error codes. */
  friendlyError(err) {
    const map = {
      'auth/email-already-in-use': 'That email already has an account — try signing in instead.',
      'auth/invalid-email': 'That email address looks invalid.',
      'auth/user-not-found': 'No account found with that email.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/invalid-credential': 'Incorrect email or password.',
      'auth/weak-password': 'Please choose a stronger password (6+ characters).',
      'auth/too-many-requests': 'Too many attempts — please wait a moment and try again.',
      'auth/network-request-failed': 'Network error — check your connection and try again.'
    };
    return map[err.code] || err.message || 'Something went wrong. Please try again.';
  }
};
