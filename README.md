# Horizon_Project — DIVEDU

A smart classroom platform with a **real** login system (Firebase
Authentication + Firestore) that works when published on GitHub
Pages — not just on localhost. Every screen now shares one visual
theme, and the teacher and student sides are genuinely connected
through Firestore: a quiz the teacher publishes shows up instantly
on every student's dashboard, attendance marked by the teacher shows
up on the student's own attendance tab, and so on.

## How it's wired together

- **`theme.css`** — the single design system (colors, buttons, cards,
  nav, tables) shared by every page, based on the landing page's
  look. Change a color here and it updates everywhere.
- **`index.html` / `index.css` / `index.js`** — landing page + Sign
  In / Create Account form. Choosing "Student" or "Teacher" sets the
  account's role at sign-up.
- **`student-dashboard.html`** — where students land after login.
  Tabs: Overview, **Milestones** (embeds `kris.html`), **AI Study
  Desk** (embeds `h.html`), Quizzes (take quizzes the teacher
  published), My Results, My Attendance, and Materials/Homework.
- **`teacher-dashboard.html`** — where teachers land after login.
  Tabs: Overview, Quiz Builder (multiple-choice, auto-graded),
  Attendance (real class roster pulled from Firestore), Results,
  Materials, and Homework.
- **`kris.html` / `kris.css` / `kris.js`** — the Milestones/assignment
  planner, restyled to match the shared theme. Embedded inside the
  student dashboard, and still works fine if opened directly.
- **`h.html`** — the **AI Study Desk**: paste any text and it produces
  an extractive summary plus key terms, entirely in the browser (no
  API key or server needed, so it works the instant the page loads —
  see the note below on how this differs from a true LLM summary).
- **`app-data.js`** — shared Firestore helpers (quizzes, attempts,
  attendance, materials, homework, results) used by both dashboards,
  so the two sides never talk to different collections by accident.
- **`firebase-config.js`** — your Firebase project's public config.
  You must fill this in (see below) before anything will work.
- **`app-auth.js`** — shared helper: sign up, sign in, sign out,
  password reset, and page-guarding used by every page.
- **`firestore.rules`** — security rules to paste into your Firebase
  project. Students can read/write only their own data; teachers get
  broader read access (roster, all attempts) and write access to
  quizzes/attendance/materials/homework/results.

## About the "AI" in AI Study Desk

`h.html` uses a real, classic NLP technique (word-frequency based
extractive summarization) that runs entirely client-side — it works
the moment the page loads, with no API key, backend, or cost. It is
not a large-language-model summary, so it won't rephrase or reason
about the text the way Claude would — it selects and reorders the
most information-dense sentences from what you pasted. If you'd
rather wire this up to a real LLM (e.g. the Claude API) for more
fluent, abstractive summaries, that just needs a backend endpoint to
hold your API key — happy to help build that next if you want it.

## New Firestore collections

Beyond the original `users` collection, the app now uses:

| Collection      | Written by | Read by |
|---|---|---|
| `quizzes`       | teacher (own docs) | everyone signed in |
| `quizAttempts`  | student (own docs) | owning student + all teachers |
| `attendance`    | teacher | owning student + all teachers |
| `materials`     | teacher | everyone signed in |
| `homework`      | teacher | everyone signed in |
| `results`       | teacher | owning student + all teachers |

Re-publish the updated `firestore.rules` in the Firebase Console
after pulling these changes, or the new tabs will get permission
errors.

Every protected page checks the visitor's login state on load. If
nobody's signed in, it redirects to `index.html`. If a student opens
a teacher page (or vice-versa) by URL, it redirects them to their own
dashboard instead.

## 1. Create your Firebase project (free)

1. Go to <https://console.firebase.google.com> and click **Add
   project**. Name it anything (e.g. "divedu").
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
dashboards.

## Notes / things you can adjust later

- Passwords must be 6+ characters (Firebase's own minimum).
- "Keep session active" uses Firebase's LOCAL persistence; leaving it
  unchecked signs the user out when the browser tab/session ends.
- "Forgot password" sends a real Firebase password-reset email.
- The stats, charts, quiz/result tables you see are still placeholder
  data — hooking those up to live Firestore data is a natural next
  step if you want the numbers to be real instead of illustrative.
