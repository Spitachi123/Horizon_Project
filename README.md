# Horizon_Project — GyanSetu

A smart classroom platform with a **real** login system (Firebase
Authentication + Firestore) that works when published on GitHub
Pages — not just on localhost. Every screen shares one visual theme,
and the teacher and student sides are genuinely connected through
Firestore: a milestone or quiz a teacher publishes shows up instantly
on every student's dashboard, and vice versa.

## Latest round of fixes

- **Fixed: the homework checklist wouldn't load.** The Firestore rule
  for `homeworkProgress` checked `resource.data.studentId` without
  first guarding for "this document doesn't exist yet" — which is
  exactly the case the very first time a student ever opens a
  homework's checklist. That null-reference check silently failed as
  a permissions error and broke the whole checklist. Fixed by allowing
  the not-yet-created case explicitly. **Re-publish `firestore.rules`
  for this fix to take effect.**
- **Fixed: the side navigation didn't work on desktop/Windows.** Two
  CSS rules for `.d-container`'s margin were tied for specificity, and
  the one that came *later* in the file (a plain reset with no
  `margin-left`) was silently overriding the one that shifted the page
  content right to make room for the docked sidebar — so on wide
  screens the sidebar sat on top of the page instead of beside it.
  Reordered so the desktop override always wins.
- **Reading materials: clearer PDF upload errors + progress bar.**
  The publish button now shows a live upload percentage, validates the
  file is really a PDF under 25 MB before attempting anything, and
  translates Firebase Storage's error codes into a plain-English
  explanation (most commonly: Storage needs to be enabled in the
  Firebase Console, which now requires the project to be on the
  Blaze pay-as-you-go plan — see step 3b below).
- **Holidays are now marked from a real calendar, in bulk.** The
  Attendance tab has a proper month calendar (defaults to the actual
  current month, with today highlighted); click any number of days —
  even a whole break — then save them all as holidays in one action.
  Clicking an already-marked day queues it for removal instead.
- **A real attendance history table.** Below the daily roll call,
  every student now has a row and every marked date a column, with a
  ✓ / ✕ / – at each cell (– means "not marked, counts as present").
- **Monthly students-vs-teachers comparison.** The Milestones tab now
  shows this month's top student, top teacher, and each side's
  combined point total side by side, alongside the existing full
  student leaderboard and Teacher Activity Ranking.
- **A more fun homework checklist.** Each homework now shows a little
  progress ring with a mood emoji (🌱 → 🌿 → 🚀 → 🔥 → 🎉), a
  streak counter for consecutive days checked off, and a confetti
  burst + celebratory toast when a checklist hits 100%.

## Previous round of changes

- **Points now come from every task, not just milestones.** A new
  unified `pointsLedger` collection is the single source of truth for
  the leaderboard, the points hero banner, and the ID card total.
  Completing a teacher's milestone still pays out as before, but now
  **submitting a quiz** (10 pts per correct answer) and **checking off
  a homework day** (10 pts/day) pay into the same ledger. Every entry's
  document id is deterministic and tied to the specific action, so
  nothing can ever be double-paid by re-clicking or refreshing.
- **Smarter attendance.** Teachers can mark any date as a holiday from
  the Attendance tab; the app automatically works out the real number
  of **working days** (weekends + marked holidays excluded) instead of
  anyone counting by hand. Any student not explicitly marked "Absent"
  on a working day is now automatically counted as **present** — the
  register only needs to record exceptions. A search box lets a
  teacher jump straight to a student by name before marking them.
- **Vertical, responsive navigation.** Both dashboards now use a
  left-hand slide-in menu (tap the ☰ icon) instead of a horizontal tab
  strip — it stays permanently docked on desktop/tablet screens and
  becomes a proper off-canvas drawer with a dimming overlay on mobile.
- **Delete unwanted accounts and content.** Teachers can now delete
  any student or teacher account from the **ID Cards** tab (this
  cascades to remove that person's attendance, quiz attempts, results,
  points, and — for a teacher — everything they published), and can
  delete any published **material** or **homework** assignment.
  Quizzes and milestones already supported delete. Note: account
  deletion removes the app profile (so the person is bounced to
  sign-in immediately) but can't revoke the underlying Firebase Auth
  login itself — that part needs a server-side Cloud Function, since
  client JS is never allowed to delete another person's credentials.
- Re-publish the updated `firestore.rules` and `storage.rules` after
  pulling these changes — several of the features above (holidays,
  the points ledger, account/content deletion) need the new rules or
  they'll fail with a permissions error.

## What was new in the previous round

- **Fixed the sign-in email field.** The email input was using
  `type="email"`, but `index.css` only styled `input[type="text"]`
  and `input[type="password"]` — so the email box never got the
  padding that makes room for the icon, and the icon sat on top of
  whatever you typed. Fixed by including `input[type="email"]` (and
  `number`/`date`, used elsewhere) in that CSS rule.
- **Smarter AI engine (`ai-engine.js`), shared by both AI tools.**
  Replaced the old word-frequency scoring with **TextRank** — a
  graph-based ranking algorithm (the same family as PageRank, applied
  to sentences) that ranks a sentence as important when it's closely
  related to many *other* important sentences, not just because it
  repeats common words. It also detects headings/structure in pasted
  text, pulls out real definitions ("X is/refers to/means Y"), and
  picks quiz blanks by rarity (more distinguishing) rather than
  frequency. It's still 100% client-side with no API key — genuinely
  better extractive/structural NLP, but still not an LLM that writes
  new sentences; wiring either AI tool to a real LLM (e.g. the Claude
  API) needs a small backend to hold the key, same as before.
- **PDF support everywhere the AI tools are used.** Both the AI Study
  Desk and AI Teaching Assistant can now take a PDF upload directly
  (via pdf.js, loaded on demand) and extract its text automatically —
  no more copy-pasting out of a PDF reader.
- **PDF reading materials.** Teachers can attach a PDF when publishing
  a resource (stored in Firebase Storage). Students see an "Open PDF"
  link and a **Summarize with AI** button that sends the file straight
  to the AI Study Desk, which downloads it, extracts the text, and
  runs a summary automatically.
- **Homework, AI-divided across days.** Teachers can give an estimated
  number of hours a homework will take; the app automatically splits
  that into a fair day-by-day plan between today and the due date
  (same idea as the old milestone planner, generalized to any
  homework). Students get a checklist with a progress bar and can
  check off each day as they complete it — progress is saved per
  student in Firestore.
- **Ranking system, expanded.** The class leaderboard now has an
  **All-time / This month** toggle for students. There's also a new
  **Teacher Activity Ranking** (visible to teachers) that scores
  teachers by their contribution to the class — quizzes, materials,
  homework, milestones created, and results graded — both all-time
  and for the current calendar month.

## What was new before that

- **Stronger login system.** "Keep session active" now truly means
  it — using Firebase's `LOCAL` persistence, a signed-in user stays
  signed in across tab closes, browser restarts, and days of
  inactivity. Nothing in the app force-logs anyone out; the only way
  to end a session is pressing **Logout**.
- **Every sign-up and sign-in is logged.** A `loginLogs` collection
  records who signed in, their role, and when — visible to teachers
  on the **ID Cards** tab, and to each student on their own **My ID
  Card** tab.
- **ID Card system.** Every account gets a permanent, sequential ID
  number at sign-up (`STU-2026-0001`, `TCH-2026-0001`, ...), plus an
  optional class/grade (students) or subject specialization
  (teachers). Teachers get a full roster of ID cards; students get
  their own digital ID card with their sign-in history and points.
- **Anonymous Q&A.** Students can ask a question from the **Ask a
  Question** tab; it's tagged internally with their account so *they*
  can see the answer, but the teacher's **Anonymous Q&A** inbox only
  ever shows the subject and question text — never the student's
  name.
- **Milestones & Points, rebuilt on Firestore.** Teachers post
  bite-sized milestones (title, subject, points, optional
  description) from the **Milestones** tab — up to **3 per teacher
  per day**. Every milestone from every teacher lands in one shared
  feed that all students see immediately. A student taps **Mark
  complete** to bank the points (each milestone can only be claimed
  once per student). Both dashboards show a live **class
  leaderboard** with rank, points, and a badge (Newcomer → Bronze →
  Silver → Gold → Platinum) based on total points.
- **AI Teaching Assistant** (`teacher-ai.html`, under the teacher's
  **AI Assistant** tab). Paste lesson notes and get an instant
  summary, key terms, draft fill-in-the-blank quiz questions, or
  milestone ideas — all client-side, no API key needed. See the note
  below on how this differs from a true LLM.

## How it's wired together

- **`theme.css`** — the single design system (colors, buttons, cards,
  nav, tables) shared by every page.
- **`index.html` / `index.css` / `index.js`** — landing page + Sign
  In / Create Account form. Choosing "Student" or "Teacher" sets the
  account's role at sign-up, along with an optional class/grade or
  subject specialization used on the ID card.
- **`student-dashboard.html`** — where students land after login.
  Tabs: Overview, **Milestones** (live points + leaderboard), **AI
  Study Desk** (embeds `h.html`), Quizzes, My Results, My Attendance,
  Materials/Homework, **Ask a Question** (anonymous Q&A), and **My ID
  Card**.
- **`teacher-dashboard.html`** — where teachers land after login.
  Tabs: Overview, Quiz Builder, Attendance, Results, Materials,
  Homework, **Anonymous Q&A**, **Milestones** (create + leaderboard),
  **ID Cards** (full roster + sign-in history), and **AI Assistant**
  (embeds `teacher-ai.html`).
- **`teacher-ai.html`** — client-side lesson summarizer, quiz-question
  drafter, and milestone-idea generator for teachers.
- **`h.html`** — the student **AI Study Desk**: paste any text and get
  an extractive summary plus key terms, entirely in the browser.
- **`app-data.js`** — shared Firestore helpers (quizzes, attempts,
  attendance, materials, homework, results, anonymous questions,
  milestones, milestone completions, leaderboard, ID-card roster,
  login history) used by both dashboards.
- **`firebase-config.js`** — your Firebase project's public config.
- **`app-auth.js`** — sign up (with ID-card generation), sign in,
  sign out, password reset, login-history logging, and page-guarding.
- **`firestore.rules`** — security rules covering every collection
  below.
- **`kris.html` / `kris.css` / `kris.js`** — the original standalone
  local-storage milestone planner. It's no longer embedded in the
  student dashboard (replaced by the Firestore-backed Milestones tab
  above) but the file is left in the project and still works if
  opened directly.

## About the "AI" features

`h.html` and `teacher-ai.html` use real, classic NLP techniques
(word-frequency extractive summarization + heuristic question
generation) that run entirely client-side — no API key, backend, or
cost, and they work the instant the page loads. They are not
large-language-model output, so they won't rephrase or reason about
the text the way Claude would — they select, reorder, and lightly
transform the most information-dense sentences from what you pasted.
If you'd rather wire this up to a real LLM (e.g. the Claude API) for
more fluent, abstractive results, that just needs a backend endpoint
to hold your API key — happy to help build that next if you want it.

## Firestore collections

| Collection             | Written by                         | Read by |
|---|---|---|
| `users`                | self, at sign-up                   | self + all teachers |
| `counters`             | anyone signed in (ID-card numbering) | anyone signed in |
| `loginLogs`            | self, every sign-in                | self + all teachers |
| `quizzes`               | teacher (own docs)                 | everyone signed in |
| `quizAttempts`          | student (own docs)                 | owning student + all teachers |
| `attendance`            | teacher                            | owning student + all teachers |
| `materials`             | teacher                            | everyone signed in |
| `homework`              | teacher                            | everyone signed in |
| `results`               | teacher                            | owning student + all teachers |
| `questions`             | student (own docs); teacher (answer) | owning student + all teachers |
| `milestones`            | teacher (max 3/day, enforced client-side) | everyone signed in |
| `milestoneCompletions`  | student (own docs, one per milestone) | everyone signed in |
| `homeworkProgress`      | student (own docs, one per homework)  | owning student + all teachers |

`materials` docs may also carry `fileURL`, `fileName`, `filePath` when
a teacher attaches a PDF (stored in **Firebase Storage**, not
Firestore). `homework` docs may carry `hours` and an AI-generated
`taskPlan` array (day label, date, hours) when a teacher gives an
estimated duration.

Re-publish the updated `firestore.rules` in the Firebase Console
after pulling these changes, or the new tabs will get permission
errors.

Every protected page checks the visitor's login state on load. If
nobody's signed in, it redirects to `index.html`. If a student opens
a teacher page (or vice-versa) by URL, it redirects them to their own
dashboard instead.

## 1. Create your Firebase project (free)

1. Go to <https://console.firebase.google.com> and click **Add
   project**. Name it anything (e.g. "gyansetu").
2. You can skip Google Analytics — it's not needed here.

## 2. Turn on Email/Password sign-in

1. In the left sidebar: **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Email/Password**.

## 3. Create a Firestore database

1. Left sidebar: **Build → Firestore Database → Create database**.
2. Choose **Start in production mode**, pick any region, click Create.
3. Go to the **Rules** tab, delete the default rules, and paste in
   the contents of `firestore.rules` from this project. Click
   **Publish**.

## 3b. Turn on Storage (only needed for PDF materials)

1. Left sidebar: **Build → Storage → Get started**. Accept the
   default production-mode rules, pick the same region as Firestore.
2. Go to the **Rules** tab, delete the default rules, and paste in
   the contents of `storage.rules` from this project. Click
   **Publish**.
3. If you skip this step, everything else still works — teachers just
   won't be able to attach a PDF to a reading material (the app shows
   a clear error instead of silently failing).

## 4. Get your web app config

1. Click the **⚙ gear icon → Project settings**.
2. Scroll to **Your apps**, click the **</>** (web) icon to register
   a new web app (any nickname is fine — you don't need Hosting).
3. Firebase shows a `firebaseConfig = { ... }` object. Copy those
   values into `firebase-config.js` in this project, replacing the
   placeholder `YOUR_...` strings.

## 5. (Recommended) Restrict your API key

By default your Firebase API key works from any website. Once you
know your GitHub Pages URL:

1. **⚙ Project settings → General**, or the Google Cloud Console
   credentials page for this project.
2. Add an **HTTP referrer restriction** for your API key limited to
   `https://<your-username>.github.io/*` (and `http://localhost:*`
   while you're testing locally).

This isn't required for the app to work, but it stops other sites
from using your Firebase project's quota.

## 6. Publish to GitHub Pages

1. Push this whole folder to a GitHub repository.
2. Repo **Settings → Pages → Build and deployment → Source**: pick
   "Deploy from a branch", choose your branch and `/ (root)`, save.
3. GitHub gives you a URL like
   `https://<your-username>.github.io/<repo-name>/`. Open it —
   `index.html` is the entry point.

Everything here is static HTML/CSS/JS talking directly to Firebase
over HTTPS, so it works identically on GitHub Pages, any other static
host, or your own computer (run a local server like
`python3 -m http.server` rather than double-clicking the file, so the
scripts load correctly).

## Testing locally first

From this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/index.html`. Sign up as a student
and as a teacher (two different email addresses) to see both
dashboards. Sign up as a second student too, so you can see the
milestone leaderboard rank more than one person.

## Notes / things you can adjust later

- Passwords must be 6+ characters (Firebase's own minimum).
- "Keep session active" uses Firebase's LOCAL persistence; leaving it
  unchecked signs the user out when the browser tab/session ends —
  everything else in the app leaves the session alone indefinitely.
- "Forgot password" sends a real Firebase password-reset email.
- The 3-milestones-per-day cap is enforced in the app's JavaScript
  (by counting today's milestones before allowing a new one). It's a
  soft limit rather than a hard security rule — a technically
  sophisticated user could bypass it by calling Firestore directly.
  If you need a hard guarantee, that's best done with a small Cloud
  Function; happy to help build that if you want it.
- The overview stats you see are otherwise all real, live Firestore
  data — quizzes, attendance, results, milestones, and points all
  update instantly across both dashboards.
