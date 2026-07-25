/* ============================================================
   APP-DATA.JS — shared Firestore helpers for quizzes, attendance,
   materials, homework, results, anonymous Q&A, and the milestone/
   points system. Loaded after app-auth.js on both dashboards so
   teacher & student pages talk to the exact same collections and
   never drift out of sync.
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

  /* ---------------- Roster / ID cards ---------------- */

  async listStudents() {
    const snap = await db.collection('users').where('role', '==', 'student').get();
    const rows = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return rows;
  },

  async listTeachers() {
    const snap = await db.collection('users').where('role', '==', 'teacher').get();
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  },

  /** Every account ever created, newest first — the master roster
   *  behind the "ID Cards" tab. */
  async listAllUsers() {
    const snap = await db.collection('users').get();
    const rows = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return rows;
  },

  /** Full sign-in history — every time anyone has entered the
   *  platform, newest first. */
  async loginHistory(limit) {
    let q = db.collection('loginLogs').orderBy('at', 'desc');
    if (limit) q = q.limit(limit);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async loginHistoryFor(uid) {
    const snap = await db.collection('loginLogs').where('uid', '==', uid).get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0));
    return rows;
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

  /* ---------------- Anonymous Q&A ----------------
     Students post a question tagged only with their studentId
     (needed so *they* can find their own question again and see
     the answer) plus their studentName. Every UI in this app that
     a *teacher* uses must never render q.studentName — that's a
     front-end contract, enforced by only ever building teacher-side
     question cards through AppData.escapeHtml(..) on the question
     text/subject and never touching studentName. The student's own
     "My Questions" view is the only place the name is implicitly
     tied to them (because it's already their own screen). */

  async askQuestion({ subject, text }) {
    const user = auth.currentUser;
    return db.collection('questions').add({
      subject, text,
      studentId: user.uid,
      studentName: user.displayName || user.email || 'Student',
      status: 'pending',
      answer: '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  /** All questions, for the teacher-side anonymous inbox. Caller
   *  must not surface `studentName` in the UI. */
  async listAllQuestions() {
    const snap = await db.collection('questions').get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return rows;
  },

  async myQuestions() {
    const user = auth.currentUser;
    const snap = await db.collection('questions').where('studentId', '==', user.uid).get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return rows;
  },

  async answerQuestion(questionId, answer) {
    const user = auth.currentUser;
    return db.collection('questions').doc(questionId).update({
      answer, status: 'answered',
      answeredBy: user.uid,
      answeredAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  /* ---------------- Milestones & Points ----------------
     A milestone is a bite-sized task a teacher drops in for the
     whole class (e.g. "Solve 5 practice sums — 20 pts"). Every
     signed-in teacher can add up to 3 per calendar day; every
     milestone from every teacher lands in one shared feed that all
     students see immediately. A student "completes" a milestone by
     creating a `milestoneCompletions` doc (one per student per
     milestone — the doc id itself prevents double-claiming), which
     is what awards the points. Totals are always computed live from
     completions rather than a cached counter, so they can never
     drift out of sync. */

  MILESTONES_PER_TEACHER_PER_DAY: 3,

  async myMilestoneCountToday() {
    const user = auth.currentUser;
    const dateStr = this.todayStr();
    const snap = await db.collection('milestones')
      .where('createdBy', '==', user.uid)
      .where('dateKey', '==', dateStr)
      .get();
    return snap.size;
  },

  async createMilestone({ title, description, subject, points }) {
    const user = auth.currentUser;
    const dateStr = this.todayStr();
    const countToday = await this.myMilestoneCountToday();
    if (countToday >= this.MILESTONES_PER_TEACHER_PER_DAY) {
      throw new Error(`You've already added ${this.MILESTONES_PER_TEACHER_PER_DAY} milestones today — try again tomorrow.`);
    }
    return db.collection('milestones').add({
      title, description: description || '', subject, points: Math.max(1, Math.round(points)),
      dateKey: dateStr,
      createdBy: user.uid,
      createdByName: user.displayName || 'Teacher',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  async deleteMilestone(id) {
    return db.collection('milestones').doc(id).delete();
  },

  /** Every milestone from every teacher, newest first — the shared
   *  feed both dashboards render. */
  async listAllMilestones() {
    const snap = await db.collection('milestones').get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return rows;
  },

  milestoneCompletionId(milestoneId, studentId) {
    return `${milestoneId}__${studentId}`;
  },

  async completeMilestone(milestone) {
    const user = auth.currentUser;
    const id = this.milestoneCompletionId(milestone.id, user.uid);
    const ref = db.collection('milestoneCompletions').doc(id);
    const existing = await ref.get();
    if (existing.exists) return existing; // already claimed — no double points
    await ref.set({
      milestoneId: milestone.id,
      milestoneTitle: milestone.title,
      subject: milestone.subject,
      points: milestone.points,
      studentId: user.uid,
      studentName: user.displayName || user.email || 'Student',
      completedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref;
  },

  async myMilestoneCompletions() {
    const user = auth.currentUser;
    const snap = await db.collection('milestoneCompletions').where('studentId', '==', user.uid).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /** Every completion by every student across every teacher's
   *  milestones — used to build the class leaderboard. */
  async allMilestoneCompletions() {
    const snap = await db.collection('milestoneCompletions').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /** { uid: { name, points, badges, completed } } for every student
   *  who has completed at least one milestone, sorted highest first. */
  async leaderboard() {
    const [completions, students] = await Promise.all([this.allMilestoneCompletions(), this.listStudents()]);
    const totals = {};
    students.forEach(s => { totals[s.uid] = { uid: s.uid, name: s.name || s.email, points: 0, completed: 0 }; });
    completions.forEach(c => {
      if (!totals[c.studentId]) totals[c.studentId] = { uid: c.studentId, name: c.studentName, points: 0, completed: 0 };
      totals[c.studentId].points += c.points || 0;
      totals[c.studentId].completed += 1;
    });
    const rows = Object.values(totals);
    rows.forEach(r => { r.badge = AppData.badgeForPoints(r.points); });
    rows.sort((a, b) => b.points - a.points);
    return rows;
  },

  badgeForPoints(points) {
    if (points >= 500) return { label: 'Platinum', icon: 'fa-gem', color: '#8b5cf6' };
    if (points >= 250) return { label: 'Gold', icon: 'fa-trophy', color: '#f0a93a' };
    if (points >= 100) return { label: 'Silver', icon: 'fa-medal', color: '#94a3b8' };
    if (points >= 25) return { label: 'Bronze', icon: 'fa-award', color: '#b45309' };
    return { label: 'Newcomer', icon: 'fa-seedling', color: '#10b981' };
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

  fmtDateTime(ts) {
    if (!ts) return '—';
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
};
