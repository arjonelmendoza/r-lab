# BatStateU R Lab

An online R programming lab for the Analytics Application course, similar to CodeChum but built for R. Students write and run R in the browser. The app records tab switches, fullscreen exits and paste attempts, and keeps a replay of how the code was typed. You grade with hidden tests.

- **Hosting:** GitHub Pages (free). Static files, no server to maintain.
- **Login and data:** Firebase (free Spark plan). Students sign in with their school Google account.
- **R engine:** [webR](https://docs.r-wasm.org/webr/), which is real R compiled to WebAssembly and runs inside each browser. Packages like `dplyr` install automatically.

| Page | Who | URL |
|---|---|---|
| `index.html` | Students | `https://<you>.github.io/<repo>/` |
| `instructor.html` | You | `https://<you>.github.io/<repo>/instructor.html` |

---

## Setup (about 20 minutes, one time)

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> → **Add project** → name it (e.g. `batstateu-rlab`). Google Analytics is optional.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable → Save.**
3. **Authentication → Settings → Authorized domains → Add domain:** `<your-github-username>.github.io`
4. **Build → Firestore Database → Create database**: choose **production mode** and location **asia-southeast1 (Singapore)**.
5. **Firestore → Rules:** delete everything, paste the contents of `firestore.rules`, then click **Publish**.
   - If your students' email domain is not `g.batstate-u.edu.ph`, edit the `schoolEmail()` line first.

### 2. Register yourself as an instructor
Firestore → **Data → Start collection**
- Collection ID: `instructors`
- Document ID: **your Google email in lowercase**, e.g. `juan.delacruz@g.batstate-u.edu.ph`
- Add any field (e.g. `name` = your name) → **Save**

Repeat this for co-instructors. Only people listed here can open the instructor page, see hidden tests, or view student data.

### 3. Connect the app to Firebase
1. Firebase → ⚙ **Project settings → General → Your apps → Web (`</>`)** → register the app (no hosting needed).
2. Copy the `firebaseConfig` values into **`js/config.js`** → `FIREBASE_CONFIG`.
   (These keys are safe to publish. Security comes from the rules.)

### 4. Publish on GitHub Pages
1. Create a new GitHub repository (e.g. `rlab`), then upload all files from this folder (keep the `js/` and `css/` folders).
2. Repo **Settings → Pages → Source: Deploy from a branch → `main` / root → Save.**
3. After a minute your site is live at `https://<you>.github.io/rlab/`.

### 5. Test before class
1. Open `instructor.html`, sign in, click **+ New activity → Load sample problems**.
2. On each problem, click **▶ Test with solution**. Every test should pass ("Ready").
3. Set Status to **Open**, then **Save**.
4. In an incognito window, open the student link with a student account (or a test account on the school domain), take the activity, switch tabs once, then submit.
5. Back on the instructor page, check **Live monitor** and run **Grade submissions**.

---

## Running an activity

1. **Setup tab:** write problems, set the time limit, and choose **Open** when class starts.
2. Share the **student link** (shown after saving) or the 6-letter **code**.
3. **Live monitor:** see who's working, time left, last signal, and flags as they happen. Click a student for their timeline, a replay of their code, their explanation, and the **+5 / +10 min** and **Allow retake** buttons.
4. When time is up, set Status to **Closed** and save. Students can no longer save work.
5. **Grades & integrity:** **Grade submissions** runs every student's code against sample + hidden tests in your browser. Keep the tab open until it finishes. Then use **Check code similarity** and **Export CSV** (scores and all flag counts, ready for your Class Record).

### Writing tests
One test per line: `points | description | R expression`. A test passes when the expression is `TRUE`.

```
3 | total_revenue is correct | isTRUE(abs(total_revenue - sum(.ref$sales$units * .ref$sales$price)) < 0.01)
1 | prints the total        | grepl("Total revenue", .output)
1 | uses group_by           | grepl("group_by", .code)
```

Inside tests you can use:
- the student's variables (e.g. `total_revenue`, `model`)
- `.ref`: a clean copy of the setup data, so it doesn't matter if the student changed `sales`
- `.output`: everything the student's code printed
- `.code`: the student's code as text

**Unique data per student.** Setup code receives `.seed`, a number unique to each student and activity. Start setup with `set.seed(.seed)` and generate the data randomly (see the sample problems). Every student then gets different numbers, so answers can't be passed around, and the tests still grade correctly because they compare against `.ref`.

**Sample tests** are visible to students through the "Check sample tests" button. **Hidden tests** and the **reference solution** are stored in a private document only instructors can read.

---

## What the integrity monitor records

| Signal | How | Shown as |
|---|---|---|
| Tab switch | Page hidden, with time away | `Tab` |
| Left the window | Window lost focus (e.g. Alt-Tab to another app), with time away | `Focus` |
| Fullscreen exit | The exam forces fullscreen and blocks the screen until the student returns | `Fullscreen` |
| Paste / drag-drop | Blocked unless the text was copied from the student's own editor | `Paste` |
| Copy of the problem text | Blocked, so it can't easily be pasted into an AI chatbot | `Copy` |
| Large insertion | More than 40 characters appearing in one keystroke (auto-typer tools) | `Burst` |
| Not typed | Final code much longer than what the student actually typed | `Not typed` |
| Second monitor | Detected in Chrome/Edge | `2 screens` |
| Offline | Lost connection, and for how long | `Offline` |
| Code replay | A snapshot every 30 s; scrub through it in the student panel | slider |

Each student gets an **Integrity** score (Low / Medium / High) that combines these signals. A watermark with the student's name and email sits behind the exam screen, which discourages sharing photos of it.

**Rules students can't get around:** flag counters can only go up, the event log can't be edited or deleted, work is refused after the time limit (+2 min grace) or once you close the activity, and students can't change their grade, start time or extra time.

### Honest limits
No browser-based system can stop a student from using AI on a **phone or second computer**. These flags catch and deter cheating on the exam device, and the replay usually shows when code was copied in by hand from somewhere else, but treat the score as a lead to follow up, not proof. For important exams, combine this with:
- unique datasets per student (built in, see above),
- the written **explanation** per problem (on by default), and short oral follow-ups for high-risk cases,
- in-room proctoring, or [Safe Exam Browser](https://safeexambrowser.org) pointed at the student link to lock the whole computer.

iPhones/iPads can't enforce fullscreen. The monitor labels them `No FS support`. Ask students to use a laptop.

---

## Privacy (Data Privacy Act, RA 10173)
The app stores each student's name, school email, code, explanations, activity log, browser type and screen size. It does **not** use the camera or microphone, and it doesn't record the screen outside the exam page. Students see a notice and must agree before starting. Tell your class at the start of the semester, and delete old activities' data in the Firebase console when no longer needed.

## Free-tier limits
The Spark plan allows **20,000 writes/day**. Each student writes about 2–4 documents per minute while working, so one 60-minute activity for 50 students uses about 10–12k writes. If you run several sections on the same day, either raise `SAVE_INTERVAL_SEC` / `SNAPSHOT_INTERVAL_SEC` in `js/config.js` or switch the project to the **Blaze** pay-as-you-go plan (writes cost roughly ₱10–15 per 100,000).

## Files
```
index.html          student page
instructor.html     instructor page
css/style.css       BatStateU styling
js/config.js        ← your settings (Firebase keys, domain, branding)
js/firebase.js      sign-in and database
js/rengine.js       R engine + grading harness (webR)
js/student.js       exam page + monitoring
js/instructor.js    builder, live monitor, grading, similarity, CSV
js/sample.js        the 3 sample problems (sales summary, dplyr, regression)
js/common.js        shared helpers
firestore.rules     security rules (paste into Firebase)
```

## Troubleshooting
- **"auth/unauthorized-domain"**: add `<you>.github.io` in Authentication → Settings → Authorized domains.
- **Instructor page says you're not registered**: the document ID in `instructors` must be your exact email in lowercase.
- **"Missing or insufficient permissions"**: the rules weren't published, or the student isn't using a school account.
- **Students can't find the activity**: its status is still **Draft**. Set it to **Open** and save.
- **R takes long the first time**: webR downloads about 20 MB once. After that the browser caches it. It loads while students read the instructions.
- **Testing the rules**: Firestore → Rules → **Rules Playground** lets you simulate a student reading `activities/CODE/private/key`. It should be denied.
