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
    const attemptRef = await db.collection('quizAttempts').add({
      quizId, quizTitle, subject, answers, score, total, percent,
      studentId: user.uid,
      studentName: user.displayName || user.email,
      submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Every task a student completes earns points, not just teacher
    // milestones — a quiz attempt banks 10 points per correct answer.
    if (score > 0) {
      await this.awardPoints({
        id: 'quiz__' + attemptRef.id,
        source: 'quiz',
        title: `Quiz: ${quizTitle}`,
        points: score * 10
      });
    }
    return attemptRef;
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

  /** Permanently removes a student or teacher account from the app.
   *  Deletes their Firestore profile (every page's protectPage() check
   *  relies on this doc, so once it's gone they're bounced to sign-in)
   *  plus every other document elsewhere in the database that belongs
   *  to them, so no orphaned rows are left behind in any list.
   *
   *  Honesty note: this cannot delete the person's actual Firebase
   *  *Authentication* sign-in credentials — only a privileged Admin
   *  SDK / Cloud Function running on a server can do that, never
   *  client-side JS. In practice that's fine: once their profile
   *  document is gone they have no working dashboard, but if you want
   *  the login itself fully revoked too, that needs a Cloud Function.
   */
  async deleteUserAccount(uid, role) {
    const batchDelete = async (query) => {
      const snap = await query.get();
      const chunks = [];
      for (let i = 0; i < snap.docs.length; i += 400) chunks.push(snap.docs.slice(i, i + 400));
      for (const chunk of chunks) {
        const batch = db.batch();
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    };

    // NOTE: loginLogs is intentionally NOT deleted here. It's an
    // append-only sign-in history log (see firestore.rules — every
    // role there is `allow update, delete: if false`, on purpose, so
    // the history can never be tampered with, not even by a teacher).
    // Earlier this cascade also tried to delete a removed user's own
    // log entries, which Firestore always rejected with "Missing or
    // insufficient permissions" — that failure aborted this whole
    // Promise.all *before* the account doc itself got deleted, which
    // is exactly the error that showed up after deleting an account.
    // Fix: leave old sign-in records in place (they're a historical
    // fact, not live data tied to the account) and never try to
    // delete them.
    await Promise.all([
      batchDelete(db.collection('attendance').where('studentId', '==', uid)),
      batchDelete(db.collection('quizAttempts').where('studentId', '==', uid)),
      batchDelete(db.collection('results').where('studentId', '==', uid)),
      batchDelete(db.collection('questions').where('studentId', '==', uid)),
      batchDelete(db.collection('milestoneCompletions').where('studentId', '==', uid)),
      batchDelete(db.collection('homeworkProgress').where('studentId', '==', uid)),
      batchDelete(db.collection('pointsLedger').where('studentId', '==', uid))
    ]);

    if (role === 'teacher') {
      await Promise.all([
        batchDelete(db.collection('quizzes').where('createdBy', '==', uid)),
        batchDelete(db.collection('materials').where('createdBy', '==', uid)),
        batchDelete(db.collection('homework').where('createdBy', '==', uid)),
        batchDelete(db.collection('milestones').where('createdBy', '==', uid)),
        batchDelete(db.collection('holidays').where('createdBy', '==', uid))
      ]);
    }

    return db.collection('users').doc(uid).delete();
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

  /* ---------------- Holidays & working-day calculation ----------------
     A teacher can mark any date as a holiday (exam break, festival,
     school closure, etc). The attendance system then figures out the
     real number of "working days" itself — every calendar day between
     the class's start date and today, minus Saturdays/Sundays (the
     standard weekend) and minus any day a teacher has marked as a
     holiday — instead of a teacher having to count it by hand. Any
     working day nobody explicitly marked is automatically treated as
     "present" for that student (only an explicit "Absent" mark counts
     against them), so the register only needs the *exceptions*. */

  async markHoliday(dateStr, note) {
    const user = auth.currentUser;
    return db.collection('holidays').doc(dateStr).set({
      date: dateStr,
      note: note || '',
      createdBy: user.uid,
      createdByName: user.displayName || 'Teacher',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  async unmarkHoliday(dateStr) {
    return db.collection('holidays').doc(dateStr).delete();
  },

  /** Marks every date in `dateStrs` as a holiday in one round trip —
   *  used by the Attendance tab's calendar, where a teacher can click
   *  a whole run of days (e.g. an entire festival week) and save them
   *  all at once instead of one date at a time. Firestore batches cap
   *  at 500 writes, so this chunks automatically just in case a huge
   *  range is ever selected. */
  async markHolidaysBulk(dateStrs, note) {
    const user = auth.currentUser;
    const unique = [...new Set(dateStrs)];
    for (let i = 0; i < unique.length; i += 400) {
      const chunk = unique.slice(i, i + 400);
      const batch = db.batch();
      chunk.forEach(dateStr => {
        batch.set(db.collection('holidays').doc(dateStr), {
          date: dateStr,
          note: note || '',
          createdBy: user.uid,
          createdByName: user.displayName || 'Teacher',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
    }
  },

  /** The bulk-unmark counterpart — removes many holiday dates in one
   *  action (e.g. a teacher re-selecting an already-marked stretch to
   *  clear it). */
  async unmarkHolidaysBulk(dateStrs) {
    const unique = [...new Set(dateStrs)];
    for (let i = 0; i < unique.length; i += 400) {
      const chunk = unique.slice(i, i + 400);
      const batch = db.batch();
      chunk.forEach(dateStr => batch.delete(db.collection('holidays').doc(dateStr)));
      await batch.commit();
    }
  },

  async listHolidays() {
    const snap = await db.collection('holidays').get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    return rows;
  },

  /** true if `dateStr` (YYYY-MM-DD) is a weekend (Sat/Sun) or a
   *  teacher-marked holiday. `holidaySet` is a Set of "YYYY-MM-DD"
   *  strings, e.g. built from listHolidays(). */
  isNonWorkingDay(dateStr, holidaySet) {
    const day = new Date(dateStr + 'T00:00:00').getDay(); // 0=Sun, 6=Sat
    return day === 0 || day === 6 || (holidaySet && holidaySet.has(dateStr));
  },

  /** Every calendar date string from `startDateStr` to `endDateStr`
   *  inclusive. */
  dateRange(startDateStr, endDateStr) {
    const out = [];
    const start = new Date(startDateStr + 'T00:00:00');
    const end = new Date(endDateStr + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push(this.localDateStr(d));
    }
    return out;
  },

  /** The AI-calculated total number of actual working days between
   *  `startDateStr` and today — weekends and marked holidays excluded
   *  automatically, so nobody has to count them by hand. */
  workingDaysBetween(startDateStr, holidaySet, endDateStr) {
    const end = endDateStr || this.todayStr();
    if (!startDateStr || startDateStr > end) return 0;
    return this.dateRange(startDateStr, end).filter(d => !this.isNonWorkingDay(d, holidaySet)).length;
  },

  /** Builds a student's attendance summary: every real working day
   *  since `joinDateStr` counts as "present" by default unless a
   *  teacher explicitly marked that student "absent" that day —
   *  matching a real classroom register, where the roll call only
   *  records exceptions instead of confirming every present student
   *  by hand every single day. */
  computeAttendanceStats(joinDateStr, attendanceRows, holidaySet, endDateStr) {
    const end = endDateStr || this.todayStr();
    const start = joinDateStr && joinDateStr <= end ? joinDateStr : end;
    const workingDays = this.dateRange(start, end).filter(d => !this.isNonWorkingDay(d, holidaySet));
    const explicitByDate = {};
    attendanceRows.forEach(r => { explicitByDate[r.date] = r.status; });
    let present = 0, absent = 0;
    workingDays.forEach(d => {
      if (explicitByDate[d] === 'absent') absent++;
      else present++; // explicit "present" OR unmarked -> present
    });
    const total = workingDays.length;
    return { totalWorkingDays: total, present, absent, rate: total ? Math.round((present / total) * 100) : 100 };
  },

  /* ---------------- Materials ---------------- */

  /** Uploads a File to Cloudinary using an unsigned upload preset
   *  (see cloudinary-config.js) — no backend or secret key needed.
   *  PDFs are uploaded as resource_type "raw" since they aren't
   *  images. `onProgress(percent)` is called repeatedly while the
   *  file uploads, if provided (via XHR so we get real progress
   *  events, which a plain fetch() can't give us). */
  _uploadToCloudinary(file, onProgress) {
    if (!window.cloudinaryConfig || !cloudinaryConfig.cloudName || cloudinaryConfig.cloudName === 'YOUR_CLOUD_NAME') {
      return Promise.reject(new Error('Cloudinary isn\'t set up for this project yet. Paste your cloud name and unsigned upload preset into cloudinary-config.js — see the README.'));
    }
    const { cloudName, uploadPreset } = cloudinaryConfig;
    const url = `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`;
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', uploadPreset);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch (e) { /* fall through to error below */ }
        if (xhr.status >= 200 && xhr.status < 300 && body.secure_url) {
          resolve(body);
        } else {
          // Translate the handful of Cloudinary errors a teacher is
          // actually likely to hit into something actionable.
          const msg = (body.error && body.error.message) || '';
          if (/preset not found|upload preset/i.test(msg)) {
            reject(new Error('Cloudinary rejected the upload — check that CLOUDINARY_UPLOAD_PRESET in cloudinary-config.js matches an existing preset set to "Unsigned" mode.'));
          } else if (/cloud_name|cloud name/i.test(msg) || xhr.status === 404) {
            reject(new Error('Cloudinary rejected the upload — check that CLOUDINARY_CLOUD_NAME in cloudinary-config.js is correct.'));
          } else {
            reject(new Error(msg || 'Could not upload the file to Cloudinary.'));
          }
        }
      };
      xhr.onerror = () => reject(new Error('Network error while uploading to Cloudinary.'));
      xhr.send(form);
    });
  },

  /** Publishes a reading material, optionally attaching a PDF file
   *  (hosted on Cloudinary, with the public secure URL saved on the
   *  Firestore doc). The PDF's text can later be pulled out
   *  on-demand by AIEngine.extractPdfTextFromUrl for the "Summarize
   *  with AI" button on the student side. `onProgress(percent)` is
   *  called repeatedly while the file uploads, if provided. */
  async publishMaterial({ subject, subtopic, description, file }, onProgress) {
    const user = auth.currentUser;
    let fileURL = '', fileName = '', filePath = '';
    if (file) {
      if (!file.type || file.type !== 'application/pdf') {
        throw new Error('Only PDF files can be attached to a reading material.');
      }
      if (file.size > 25 * 1024 * 1024) {
        throw new Error('That PDF is larger than 25 MB — please attach a smaller file.');
      }
      const uploaded = await this._uploadToCloudinary(file, onProgress);
      fileURL = uploaded.secure_url;
      // public_id (+ resource_type) is what's needed to delete the
      // file later via Cloudinary's Admin API.
      filePath = uploaded.public_id;
      fileName = file.name;
    }
    return db.collection('materials').add({
      subject, subtopic, description, fileURL, fileName, filePath,
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

  /** Removes a published material's Firestore record. Note: unlike
   *  Firebase Storage, Cloudinary's *unsigned* uploads (the kind used
   *  here, with no backend) can't be securely deleted straight from
   *  browser JS — actually deleting the file requires your Cloudinary
   *  API secret, which must never be shipped to the browser. So this
   *  removes the material from the app immediately; the underlying
   *  PDF is left on Cloudinary and can be bulk-cleaned up any time
   *  from the Cloudinary Console (Media Library) or via a small
   *  server-side script using the Admin API and each file's
   *  `filePath` (its Cloudinary public_id). */
  async deleteMaterial(materialId) {
    return db.collection('materials').doc(materialId).delete();
  },

  /* ---------------- Homework ----------------
     If a teacher gives an estimated duration (in hours), homework is
     automatically split into a fair day-by-day task plan between
     today and the due date — the same "divide the work evenly across
     the days you actually have" idea as the old kris.js planner,
     generalized to every homework assignment so students get a
     realistic daily time-management schedule instead of one big
     deadline looming at the end. */

  buildHomeworkPlan(hours, dueDateStr) {
    const due = new Date(dueDateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysLeft = Math.max(1, Math.round((due - today) / 86400000) + 1); // inclusive of today & due date
    const perDay = hours / daysLeft;
    const tasks = [];
    for (let i = 0; i < daysLeft; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      tasks.push({
        label: `Day ${i + 1}`,
        // "date" (YYYY-MM-DD) is the real calendar day this task plan
        // entry belongs to — lets the student dashboard lock a day's
        // checkbox until that actual date arrives, so a student can't
        // check off a future day and claim its points early. It stays
        // locked until that date arrives, then unlocks automatically.
        date: this.localDateStr(d),
        dateLabel: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        hours: Math.round(perDay * 10) / 10
      });
    }
    return tasks;
  },

  async publishHomework({ subject, dueDate, instructions, hours }) {
    const user = auth.currentUser;
    const h = parseFloat(hours) || 0;
    const taskPlan = h > 0 ? this.buildHomeworkPlan(h, dueDate) : [];
    return db.collection('homework').add({
      subject, dueDate, instructions, hours: h, taskPlan,
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

  async deleteHomework(homeworkId) {
    return db.collection('homework').doc(homeworkId).delete();
  },

  homeworkProgressId(homeworkId, studentId) {
    return `${homeworkId}__${studentId}`;
  },

  /** The current student's checked-off days for one homework's task
   *  plan. Returns { completed: [dayIndex, ...] }. */
  async getMyHomeworkProgress(homeworkId) {
    const user = auth.currentUser;
    const id = this.homeworkProgressId(homeworkId, user.uid);
    const snap = await db.collection('homeworkProgress').doc(id).get();
    return snap.exists ? snap.data() : { completed: [] };
  },

  async toggleHomeworkTask(homeworkId, taskIndex, done) {
    const user = auth.currentUser;

    // A day can only be checked off once its own calendar date has
    // actually arrived — never in advance. (Unchecking a day, or
    // catching up on a past day, is always allowed.)
    if (done) {
      const hwSnap = await db.collection('homework').doc(homeworkId).get();
      const plan = hwSnap.exists ? (hwSnap.data().taskPlan || []) : [];
      const task = plan[taskIndex];
      if (task && task.date && task.date > this.todayStr()) {
        throw new Error(`This day unlocks on ${task.dateLabel} — you can't check it off early.`);
      }
    }

    const id = this.homeworkProgressId(homeworkId, user.uid);
    const ref = db.collection('homeworkProgress').doc(id);
    const snap = await ref.get();
    let completed = snap.exists ? (snap.data().completed || []) : [];
    if (done) { if (!completed.includes(taskIndex)) completed.push(taskIndex); }
    else { completed = completed.filter(i => i !== taskIndex); }

    // Every task a student completes earns points — checking off a
    // planned homework day banks points too; unchecking it removes
    // them again (the deterministic id means re-checking never lets
    // the same day pay out twice). The checklist tick and its points
    // are written in a single atomic batch, so a day can never end up
    // marked "done" on screen while its points silently fail to land
    // (or the reverse) — the two always move together.
    const pointId = `hw__${homeworkId}__${user.uid}__day${taskIndex}`;
    const pointRef = db.collection('pointsLedger').doc(pointId);
    const batch = db.batch();
    batch.set(ref, {
      homeworkId, studentId: user.uid, completed,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    if (done) {
      const pointSnap = await pointRef.get();
      if (!pointSnap.exists) {
        batch.set(pointRef, {
          source: 'homework', title: 'Homework day completed', points: 10,
          studentId: user.uid,
          studentName: user.displayName || user.email || 'Student',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    } else {
      batch.delete(pointRef);
    }
    await batch.commit();
    return completed;
  },

  /** Every student's progress on every homework — used by the teacher
   *  dashboard to show class-wide completion rates. */
  async allHomeworkProgress() {
    const snap = await db.collection('homeworkProgress').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

  /** Anonymous inbox, scoped to the signed-in teacher's own subject
   *  (plus anything tagged "General", so nobody's untargeted question
   *  falls through the cracks). A Physics teacher never sees a Maths
   *  question and vice-versa. Requires the teacher's profile to have
   *  `subjectFocus` set — see AppData.updateMySubject().
   *  This mirrors firestore.rules exactly: the rule only allows
   *  reading a question doc when its `subject` field equals the
   *  caller's own subjectFocus (or is "General"), so this query's
   *  `where('subject','in', [...])` clause is required — Firestore
   *  rejects unfiltered list queries it can't prove are safe. */
  async listQuestionsForMySubject() {
    const profile = window.currentUserProfile || {};
    const mySubject = profile.subjectFocus || '';
    if (!mySubject) return []; // teacher hasn't set a subject yet
    const subjects = mySubject === 'General' ? ['General'] : [mySubject, 'General'];
    const snap = await db.collection('questions').where('subject', 'in', subjects).get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return rows;
  },

  /** Lets a teacher set/change which subject they teach. This is
   *  what the "respective subject teacher" scoping (anonymous
   *  questions + result entry) is keyed off of. Does not touch
   *  `role`, so it's always allowed by firestore.rules. */
  async updateMySubject(subject) {
    const user = auth.currentUser;
    await db.collection('users').doc(user.uid).update({ subjectFocus: subject });
    if (window.currentUserProfile) window.currentUserProfile.subjectFocus = subject;
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

  /** Removes an anonymous question from the inbox entirely (e.g. spam,
   *  a duplicate, or something answered privately in class already).
   *  Any signed-in teacher may do this — same broad "moderation"
   *  permission the milestone feed's delete already uses. */
  async deleteQuestion(questionId) {
    return db.collection('questions').doc(questionId).delete();
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

    // The completion doc and its points-ledger entry are written in one
    // atomic batch. Previously these were two separate writes, so if the
    // second one ever failed (a dropped connection, a rules hiccup) a
    // student could end up with a milestone marked "Done" whose points
    // never actually landed in their total or on the leaderboard. A
    // batch guarantees both happen together, or neither does.
    const pointId = 'milestone__' + id;
    const pointRef = db.collection('pointsLedger').doc(pointId);
    const batch = db.batch();
    batch.set(ref, {
      milestoneId: milestone.id,
      milestoneTitle: milestone.title,
      subject: milestone.subject,
      points: milestone.points,
      studentId: user.uid,
      studentName: user.displayName || user.email || 'Student',
      completedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    batch.set(pointRef, {
      source: 'milestone', title: milestone.title,
      points: Math.max(0, Math.round(milestone.points)),
      studentId: user.uid,
      studentName: user.displayName || user.email || 'Student',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    return ref;
  },

  async myMilestoneCompletions() {
    const user = auth.currentUser;
    const snap = await db.collection('milestoneCompletions').where('studentId', '==', user.uid).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /** Every completion by every student across every teacher's
   *  milestones — used to show milestone-specific counts on the
   *  leaderboard (separate from the total points figure, which now
   *  also includes quizzes and homework). */
  async allMilestoneCompletions() {
    const snap = await db.collection('milestoneCompletions').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /* ---------------- Unified points ledger ----------------
     Every point-earning action a student takes — completing a
     teacher's milestone, submitting a quiz, checking off a planned
     homework day — writes one entry here. Each entry's document id is
     deterministic and source-specific, so the *same* action can never
     pay out twice (re-clicking, refreshing, or re-submitting is always
     safe), while genuinely different actions each get their own entry
     and their own points. This is what the leaderboard, the points
     hero banner, and the ID card total are all actually built from. */

  async awardPoints({ id, source, title, points }) {
    const user = auth.currentUser;
    const ref = db.collection('pointsLedger').doc(id);
    const existing = await ref.get();
    if (existing.exists) return existing; // this exact action already paid out
    return ref.set({
      source, title, points: Math.max(0, Math.round(points)),
      studentId: user.uid,
      studentName: user.displayName || user.email || 'Student',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  /** Removes a previously-awarded ledger entry (used when a student
   *  unchecks a homework day they'd checked off before). */
  async revokePoints(id) {
    return db.collection('pointsLedger').doc(id).delete().catch(() => {});
  },

  async myPointsLedger() {
    const user = auth.currentUser;
    const snap = await db.collection('pointsLedger').where('studentId', '==', user.uid).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /** Every points-ledger entry from every student — the single source
   *  of truth behind the class leaderboard. */
  async allPointsLedger() {
    const snap = await db.collection('pointsLedger').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /** "YYYY-MM" key for a date, used to bucket points/activity into
   *  calendar months for the "this month" progress views. */
  monthKey(date) {
    const d = date || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  },
  tsToDate(ts) {
    return ts && ts.seconds ? new Date(ts.seconds * 1000) : null;
  },

  /** { uid: { name, points, monthPoints, badges, completed } } for
   *  every student who has earned at least one point from *any* task
   *  (milestones, quizzes, homework days), ranked highest points
   *  first. `completed`/`monthCompleted` count milestone completions
   *  specifically (what the "X milestones completed" caption shows);
   *  `points`/`monthPoints` are the student's full points total across
   *  every task type. monthPoints is this calendar month only, so
   *  both dashboards can show "total" and "this month's progress"
   *  ranking side by side. */
  async leaderboard() {
    const [ledger, completions, students] = await Promise.all([
      this.allPointsLedger(), this.allMilestoneCompletions(), this.listStudents()
    ]);
    const thisMonth = this.monthKey();
    const totals = {};
    students.forEach(s => { totals[s.uid] = { uid: s.uid, name: s.name || s.email, points: 0, completed: 0, monthPoints: 0, monthCompleted: 0 }; });

    ledger.forEach(p => {
      if (!totals[p.studentId]) totals[p.studentId] = { uid: p.studentId, name: p.studentName, points: 0, completed: 0, monthPoints: 0, monthCompleted: 0 };
      totals[p.studentId].points += p.points || 0;
      const d = this.tsToDate(p.createdAt);
      if (d && this.monthKey(d) === thisMonth) totals[p.studentId].monthPoints += p.points || 0;
    });
    completions.forEach(c => {
      if (!totals[c.studentId]) totals[c.studentId] = { uid: c.studentId, name: c.studentName, points: 0, completed: 0, monthPoints: 0, monthCompleted: 0 };
      totals[c.studentId].completed += 1;
      const d = this.tsToDate(c.completedAt);
      if (d && this.monthKey(d) === thisMonth) totals[c.studentId].monthCompleted += 1;
    });

    const rows = Object.values(totals);
    rows.forEach(r => { r.badge = AppData.badgeForPoints(r.points); });
    rows.sort((a, b) => b.points - a.points);
    return rows;
  },

  /** Teacher activity ranking — rewards teachers for how much they've
   *  actually contributed to the class (weighted: quiz=5, material=3,
   *  homework=3, milestone=2, graded result=1), all-time and for this
   *  calendar month, so both dashboards can show a teacher leaderboard
   *  alongside the student one. */
  async teacherLeaderboard() {
    const [teachers, quizzes, materials, homework, milestones, results] = await Promise.all([
      this.listTeachers(), this.listQuizzes(), this.listMaterials(), this.listHomework(), this.listAllMilestones(),
      // allResults() reads every result doc unfiltered. firestore.rules
      // only lets a STUDENT read their own graded results (correctly —
      // grades are private between students), so Firestore rejects
      // that whole query the moment a student runs it, since there's
      // no filter it can use to prove every row is allowed. Without
      // this .catch, that rejection would blow up this entire
      // Promise.all — which is exactly what broke the Overview tab's
      // "Top 3 Teachers" widget for students while Milestones (which
      // never calls allResults()) kept working fine. A teacher still
      // gets the real, accurate count when they load this themselves;
      // a student's view of a teacher's score just slightly
      // undercounts the "results graded" component instead of
      // crashing the page.
      this.allResults().catch(() => [])
    ]);
    const thisMonth = this.monthKey();
    const totals = {};
    teachers.forEach(t => {
      totals[t.uid] = { uid: t.uid, name: t.name || t.email, score: 0, monthScore: 0, quizzes: 0, materials: 0, homework: 0, milestones: 0, results: 0 };
    });
    const bump = (list, field, weight) => {
      list.forEach(item => {
        const uid = item.createdBy;
        if (!uid || !totals[uid]) return;
        totals[uid].score += weight;
        totals[uid][field] += 1;
        const d = this.tsToDate(item.createdAt);
        if (d && this.monthKey(d) === thisMonth) totals[uid].monthScore += weight;
      });
    };
    bump(quizzes, 'quizzes', 5);
    bump(materials, 'materials', 3);
    bump(homework, 'homework', 3);
    bump(milestones, 'milestones', 2);
    bump(results, 'results', 1);
    const rows = Object.values(totals);
    rows.sort((a, b) => b.score - a.score);
    return rows;
  },

  /** A single end-of-month-style comparison: the top student and top
   *  teacher (by this calendar month's points/score), plus the class's
   *  combined student total vs. combined teacher total for the month —
   *  used to render a "students vs teachers" leaderboard comparison
   *  panel on the Milestones tab. */
  async monthlyComparison() {
    const [students, teachers] = await Promise.all([this.leaderboard(), this.teacherLeaderboard()]);
    const topStudent = [...students].sort((a, b) => b.monthPoints - a.monthPoints)[0] || null;
    const topTeacher = [...teachers].sort((a, b) => b.monthScore - a.monthScore)[0] || null;
    return {
      topStudent,
      topTeacher,
      studentMonthTotal: students.reduce((s, r) => s + (r.monthPoints || 0), 0),
      teacherMonthTotal: teachers.reduce((s, r) => s + (r.monthScore || 0), 0)
    };
  },

  badgeForPoints(points) {
    if (points >= 500) return { label: 'Platinum', icon: 'fa-gem', color: '#8b5cf6' };
    if (points >= 250) return { label: 'Gold', icon: 'fa-trophy', color: '#f0a93a' };
    if (points >= 100) return { label: 'Silver', icon: 'fa-medal', color: '#94a3b8' };
    if (points >= 25) return { label: 'Bronze', icon: 'fa-award', color: '#b45309' };
    return { label: 'Newcomer', icon: 'fa-seedling', color: '#10b981' };
  },

  /* ---------------- Small utils ---------------- */

  /** Formats a Date as "YYYY-MM-DD" using the *browser's local*
   *  calendar day, never UTC. `Date#toISOString()` always converts to
   *  UTC first, so anyone ahead of UTC (e.g. Nepal is UTC+5:45) would
   *  see "today" reported as the previous day for the first ~5h45m
   *  after their local midnight. That mismatch was the root cause of
   *  homework day-plan entries unlocking a full calendar day early —
   *  a task correctly labelled "tomorrow" locally could still compare
   *  as "today or earlier" once converted to UTC. Every date-only
   *  string in the app (today's date, homework day-plan dates,
   *  attendance date ranges) must be built through this one helper so
   *  "today" always means the same real calendar day everywhere. */
  localDateStr(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  todayStr() {
    return this.localDateStr(new Date());
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
