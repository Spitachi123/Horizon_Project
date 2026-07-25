/* ============================================================
   APP-DATA.JS — shared Firestore helpers for quizzes, attendance,
   materials, homework and results. Loaded after app-auth.js on
   both dashboards so teacher & student pages talk to the exact
   same collections and never drift out of sync.
   ============================================================ */

const AppData = {

  /* ---------------- Quizzes ---------------- */

  async createQuiz({ title, subject, questions }) {
    const user = auth.currentUser;
    return db.collection('quizzes').add({
      title, subject, questions,
      createdBy: user.uid,
      createdByName: user.displayName || 'Teacher',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  async listQuizzes() {
    const snap = await db.collection('quizzes').get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return rows;
  },

  async deleteQuiz(quizId) {
    return db.collection('quizzes').doc(quizId).delete();
  },

  async submitAttempt({ quizId, quizTitle, subject, answers, score, total }) {
    const user = auth.currentUser;
    const percent = total > 0 ? Math.round((score / total) * 100) : 0;
    return db.collection('quizAttempts').add({
      quizId, quizTitle, subject, answers, score, total, percent,
      studentId: user.uid,
      studentName: user.displayName || user.email,
      submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  async myAttempts() {
    const user = auth.currentUser;
    const snap = await db.collection('quizAttempts').where('studentId', '==', user.uid).get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
    return rows;
  },

  async attemptsForQuiz(quizId) {
    const snap = await db.collection('quizAttempts').where('quizId', '==', quizId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async allAttempts() {
    const snap = await db.collection('quizAttempts').get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
    return rows;
  },

  /* ---------------- Roster ---------------- */

  async listStudents() {
    const snap = await db.collection('users').where('role', '==', 'student').get();
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  },

  /* ---------------- Attendance ---------------- */

  attendanceRowId(dateStr, studentId) {
    return `${dateStr}__${studentId}`;
  },

  async setAttendance({ dateStr, studentId, studentName, subject, status }) {
    const user = auth.currentUser;
    const id = this.attendanceRowId(dateStr, studentId);
    return db.collection('attendance').doc(id).set({
      date: dateStr, studentId, studentName, subject, status,
      markedBy: user.uid,
      markedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  async attendanceForDate(dateStr) {
    const snap = await db.collection('attendance').where('date', '==', dateStr).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async myAttendance() {
    const user = auth.currentUser;
    const snap = await db.collection('attendance').where('studentId', '==', user.uid).get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    return rows;
  },

  async allAttendance() {
    const snap = await db.collection('attendance').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /* ---------------- Materials ---------------- */

  async publishMaterial({ subject, subtopic, description }) {
    const user = auth.currentUser;
    return db.collection('materials').add({
      subject, subtopic, description,
      createdBy: user.uid,
      createdByName: user.displayName || 'Teacher',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  async listMaterials() {
    const snap = await db.collection('materials').get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return rows;
  },

  /* ---------------- Homework ---------------- */

  async publishHomework({ subject, dueDate, instructions }) {
    const user = auth.currentUser;
    return db.collection('homework').add({
      subject, dueDate, instructions,
      createdBy: user.uid,
      createdByName: user.displayName || 'Teacher',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  async listHomework() {
    const snap = await db.collection('homework').get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return rows;
  },

  /* ---------------- Results ---------------- */

  async publishResult({ studentId, studentName, subject, fullMarks, passMarks, gainedMarks }) {
    const user = auth.currentUser;
    const percent = fullMarks > 0 ? Math.round((gainedMarks / fullMarks) * 100) : 0;
    let grade = 'F';
    if (percent >= 90) grade = 'A+';
    else if (percent >= 80) grade = 'A';
    else if (percent >= 70) grade = 'B+';
    else if (percent >= 60) grade = 'B';
    else if (percent >= 50) grade = 'C';
    else if (percent >= 40) grade = 'D';
    const status = gainedMarks >= passMarks ? 'pass' : 'fail';
    return db.collection('results').add({
      studentId, studentName, subject, fullMarks, passMarks, gainedMarks, percent, grade, status,
      createdBy: user.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  async myResults() {
    const user = auth.currentUser;
    const snap = await db.collection('results').where('studentId', '==', user.uid).get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return rows;
  },

  async allResults() {
    const snap = await db.collection('results').get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return rows;
  },

  /* ---------------- Small utils ---------------- */

  todayStr() {
    return new Date().toISOString().slice(0, 10);
  },

  fmtDate(ts) {
    if (!ts) return '—';
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
};
