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
// Only pages that load firebase-storage-compat.js (teacher/student
// dashboards, for PDF reading-material uploads) get a working
// `storage` handle — everything else safely gets null and skips
// file-upload features.
window.storage = (firebase.storage && typeof firebase.storage === 'function') ? firebase.storage() : null;

const AppAuth = {
  // Where each role lands after logging in.
  ROLE_PAGES: {
    student: 'student-dashboard.html',
    teacher: 'teacher-dashboard.html'
  },

  /** Atomically hands out the next sequential ID number for a role
   *  (STU-2026-0001, TCH-2026-0001, ...) using a tiny counter doc
   *  so two people signing up at the same moment never collide. */
  async _nextIdCardNumber(role) {
    const year = new Date().getFullYear();
    const counterRef = db.collection('counters').doc(role + '_' + year);
    const prefix = role === 'teacher' ? 'TCH' : 'STU';
    try {
      const next = await db.runTransaction(async (tx) => {
        const snap = await tx.get(counterRef);
        const current = snap.exists ? (snap.data().value || 0) : 0;
        const value = current + 1;
        tx.set(counterRef, { value }, { merge: true });
        return value;
      });
      return `${prefix}-${year}-${String(next).padStart(4, '0')}`;
    } catch (err) {
      // Counter is a nice-to-have; never let it block account creation.
      return `${prefix}-${year}-${String(Date.now()).slice(-4)}`;
    }
  },

  /** Create a brand-new account, its profile document (the "ID card"
   *  record), and a first entry in the login history log. */
  async signUp(fullName, email, password, role, extra) {
    extra = extra || {};
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: fullName });

    const idCardNo = await this._nextIdCardNumber(role);

    const profile = {
      name: fullName,
      email: email,
      role: role,
      idCardNo: idCardNo,
      grade: extra.grade || '',
      subjectFocus: extra.subjectFocus || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('users').doc(cred.user.uid).set(profile);

    await this._logLogin(cred.user, role, idCardNo, true);

    return { user: cred.user, role, idCardNo };
  },

  /** Sign in an existing user, look up their stored role/ID card, and
   *  record the visit in the login history log so every sign-in by
   *  every student/teacher is kept on file. */
  async signIn(email, password, rememberMe) {
    // "Keep session active" -> Firebase LOCAL persistence, which
    // survives closing the tab/browser entirely. The user then stays
    // signed in until they press Logout themselves (or, if left
    // unchecked, SESSION persistence ends when the browser session
    // ends). Nothing else in this app ever force-logs anyone out.
    await auth.setPersistence(
      rememberMe ? firebase.auth.Auth.Persistence.LOCAL
                 : firebase.auth.Auth.Persistence.SESSION
    );
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const snap = await db.collection('users').doc(cred.user.uid).get();
    const data = snap.exists ? snap.data() : {};
    const role = data.role || 'student';

    await this._logLogin(cred.user, role, data.idCardNo || '', rememberMe);

    return { user: cred.user, role };
  },

  /** Append-only record of every sign-in/sign-up, per user. Lets a
   *  teacher see exactly who has entered the platform and when.
   *  Never blocks login if writing the log fails. */
  async _logLogin(user, role, idCardNo, remembered) {
    try {
      await db.collection('loginLogs').add({
        uid: user.uid,
        name: user.displayName || user.email || 'Unknown',
        email: user.email || '',
        role: role,
        idCardNo: idCardNo || '',
        remembered: !!remembered,
        at: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) {
      console.warn('Could not record login history:', err);
    }
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
   * With "Keep session active" checked at sign-in, Firebase's LOCAL
   * persistence means this onAuthStateChanged callback keeps firing
   * with the same signed-in user across new tabs, browser restarts,
   * and days/weeks of inactivity — nobody is logged out automatically.
   * The only way out is the Logout button, which calls signOutUser().
   *
   * Also auto-fills any element with [data-user-name] / [data-user-role]
   * / [data-user-idcard] and wires up any element with [data-logout]
   * to sign out. Fires a `profileReady` event on `document` once the
   * full profile (including idCardNo, grade, subjectFocus) is loaded.
   */
  protectPage(requiredRole) {
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        (window.top || window).location.href = 'index.html';
        return;
      }

      let role = 'student';
      let profile = {};
      try {
        const snap = await db.collection('users').doc(user.uid).get();
        if (snap.exists) { profile = snap.data(); role = profile.role; }
      } catch (err) {
        console.error('Could not load user profile:', err);
      }

      if (requiredRole && role !== requiredRole) {
        (window.top || window).location.href = this.ROLE_PAGES[role] || 'index.html';
        return;
      }

      window.currentUserProfile = Object.assign({ uid: user.uid }, profile);

      document.querySelectorAll('[data-user-name]').forEach(el => {
        el.textContent = user.displayName || user.email;
      });
      document.querySelectorAll('[data-user-role]').forEach(el => {
        el.textContent = role.toUpperCase();
      });
      document.querySelectorAll('[data-user-idcard]').forEach(el => {
        el.textContent = profile.idCardNo || '—';
      });
      document.querySelectorAll('[data-logout]').forEach(el => {
        el.addEventListener('click', (e) => { e.preventDefault(); AppAuth.signOutUser(); });
      });

      document.dispatchEvent(new CustomEvent('profileReady', { detail: window.currentUserProfile }));
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
