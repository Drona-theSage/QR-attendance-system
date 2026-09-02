# QR Attendance System

A QR-based attendance system built as a learning project with a React/Vite frontend, an Express API, MongoDB Atlas, Google student verification, browser geolocation, and CSV attendance export.

## Current Features

### 1. Admin account and authentication

- Admin registration requires name, email, password, course, and course duration.
- Passwords are hashed with bcrypt.
- Login uses an `httpOnly` JWT cookie.
- Admin-only routes require a valid authentication cookie.
- Logout clears the cookie and returns the browser to the login page.
- Forgot-password creates a one-time reset token and can send a reset email through SMTP.
- Admin registration currently accepts any email address. The university domain restriction applies to students.

### 2. Subject and course management

- Each admin has a subject catalog scoped to the admin and course.
- Admins can use existing subjects or create custom subjects.
- Subjects can be deleted from MongoDB and removed from the UI without a refresh.
- Course and course duration are stored with the admin account.

### 3. QR attendance workflow

1. The admin selects a subject and course.
2. The browser requests the admin's current location.
3. The API stores the classroom coordinates, expiry time, subject, and course in MongoDB.
4. The API creates a cryptographically random token and QR image.
5. Students open `/attendance/:token` from the QR code.
6. Students enter their name and class roll number.
7. Students authenticate their email through Google Sign-In.
8. The server verifies the Google ID token, verified email status, configured university domain, location accuracy, distance, session expiry, and duplicate attendance.
9. The attendance record is stored in MongoDB.

The frontend never decides whether attendance is valid. The server performs the validation.

### 4. Admin reporting and manual attendance

- Admins can view session history and attendance totals.
- Admins can manually mark attendance when a student has a technical problem.
- After a session expires, admins can download a CSV attendance list.
- The CSV contains student name, class roll number, subject, status, and timestamp. Student email addresses are intentionally excluded.
- Session ownership is checked for protected admin operations.

## Development Journey And Bugs Solved

### Step 1: Local MVP

Built the initial Express and React/Vite workflow with short-lived QR sessions, browser geolocation, server-side distance validation, university-domain checking, and duplicate prevention.

### Step 2: Local usability fixes

- Added a visible student URL and copy button below the QR code.
- Fixed university-domain validation so academic subdomains are accepted.
- Added clear location and expired-session messages.
- Cleared stale Node processes and documented the Windows port conflict workflow.

### Step 3: MongoDB persistence

- Added Mongoose models for admins, subjects, attendance sessions, and attendance records.
- Added MongoDB connection configuration through `MONGO_URI`.
- Moved subject catalogs into MongoDB and scoped them by admin/course.
- Verified the app against MongoDB Atlas.
- Removed full MongoDB URI logging so database credentials are not printed at startup.

### Step 4: Admin features

- Added course and course-duration fields during registration.
- Added admin login, logout, session checks, and protected routes.
- Added password hashing and password reset through SMTP.
- Added custom subject creation and subject deletion.
- Added session history and manual attendance.
- Added expired-session CSV export.

### Step 5: Deployment fixes

- Configured Render for the Express backend and Vercel for the Vite frontend.
- Added `client/vercel.json` so direct QR and password-reset routes load the React application.
- Updated production cookies to use `SameSite=None; Secure` for separate Vercel and Render domains.
- Documented the separation between public frontend configuration and private backend secrets.
- Diagnosed Render errors caused by the wrong root directory and `npm run build` being used for the backend.

### Step 6: Google student verification

- Added Google Identity Services to the student page.
- Added server-side Google ID-token verification using `google-auth-library`.
- Attendance now requires a verified Google email and the configured university domain.
- Added `VITE_GOOGLE_CLIENT_ID` for the frontend and `GOOGLE_CLIENT_ID` for the backend.

## Project Structure

```text
client/
  index.html
  vercel.json
  src/main.jsx
  src/styles.css
server/
  src/auth.js       Authentication and cookies
  src/db.js         MongoDB connection
  src/index.js      Express application startup
  src/models.js     Mongoose schemas
  src/routes.js     API routes and validation
  src/store.js      Legacy in-memory learning examples
  src/utils.js      Tokens, distance, and email-domain helpers
  test/             Node test-suite
```

## Local Setup

Prerequisite: Node.js 20 or newer.

```powershell
npm install
npm run install:all
```

Create local environment files from the examples:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
```

Set these local Google values using the same OAuth Web Client ID:

```env
# client/.env
VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
```

```env
# server/.env
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
```

Start the services in separate terminals on Windows:

```powershell
npm start --prefix server
npm run dev --prefix client
```

Open `http://localhost:5173`.

The server uses local MongoDB by default. To use Atlas, set `MONGO_URI` to the Atlas connection string. The database name should be included in the URI, for example:

```env
MONGO_URI=mongodb+srv://USER:PASSWORD@cluster.mongodb.net/qr-attendance
```

Never commit `.env` files. They are ignored by Git.

## Deployment

Recommended arrangement:

```text
Frontend: Vercel
Backend: Render
Database: MongoDB Atlas
Email: Gmail SMTP with an app password
```

Render backend settings:

```text
Root Directory: server
Build Command: npm install
Start Command: npm start
```

Vercel frontend settings:

```text
Root Directory: client
Build Command: npm run build
Output Directory: dist
```

Production variables on Render:

```env
NODE_ENV=production
MONGO_URI=your-atlas-connection-string
FRONTEND_URL=https://your-frontend-domain.com
JWT_SECRET=long-random-production-secret
GOOGLE_CLIENT_ID=your-google-client-id
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-sending-gmail-address
SMTP_PASS=your-gmail-app-password
SMTP_FROM=your-sending-gmail-address
```

Production variables on Vercel:

```env
VITE_API_URL=https://your-render-service.onrender.com/api
VITE_GOOGLE_CLIENT_ID=your-google-client-id
```

`VITE_` values are public because Vite embeds them into browser JavaScript. Keep `MONGO_URI`, `JWT_SECRET`, and `SMTP_PASS` private on the backend host.

After updating production environment variables, redeploy the affected service. New QR codes must be generated after `FRONTEND_URL` is updated; old QR codes keep their original URL.

## Tests Performed

Backend tests were run against an isolated local test database so production Atlas data was not changed:

```powershell
$env:NODE_ENV='test'
$env:MONGO_URI='mongodb://127.0.0.1:27017/qr-attendance-test'
$env:SMTP_USER=''
$env:SMTP_PASS=''
npm test --prefix server
```

## JavaScript And React Syntax Guide

The source comments explain the important runtime decisions. These are the main syntax patterns used in the project:

- `const value = ...` declares a variable that cannot be reassigned. Use `let` only when reassignment is required.
- `function name() {}` declares a reusable function. `async function` allows `await` for asynchronous work such as database and HTTP operations.
- `const { email, password } = request.body` uses destructuring to copy named properties into local variables.
- `{ email, password }` uses object shorthand and is equivalent to `{ email: email, password: password }`.
- `items.map((item) => ...)` transforms every array item into JSX or another value.
- `condition && <Component />` renders JSX only when `condition` is truthy.
- `useState(initialValue)` returns the current state and a setter that triggers a re-render.
- `useEffect(() => {}, [])` runs side effects after rendering; the dependency array controls when it runs.
- JSX uses `className` because `class` is a JavaScript language keyword. `{}` inserts JavaScript expressions into JSX.
- `return response.status(400).json(...)` sends an HTTP response and exits the route early.
- `await` pauses one asynchronous function until a Promise completes without blocking the Node.js process.

Comments are concentrated around behavior, data flow, security, and React lifecycle logic. Commenting every punctuation-level line would make the code harder to scan rather than easier to learn.

Verified checks include:

- Health endpoint returns the expected API status.
- Registration validates course and duration.
- Login sets an `httpOnly` cookie.
- Protected routes reject unauthenticated requests.
- Multiple admins and course mappings work correctly.
- Subject creation, scoping, persistence, and deletion work.
- Custom subjects and courses can create sessions.
- Session responses contain usable QR/student URLs.
- Student name and roll number are required and stored.
- Manual attendance works and prevents duplicates.
- Session history returns totals.
- Active sessions cannot be exported.
- Expired sessions produce a correctly quoted CSV without student emails.
- Distance calculation works for identical coordinates.
- University subdomains are accepted and non-university addresses are rejected.

Current verification result:

```text
20/20 backend tests passed
Frontend production build passed
Frontend and backend diagnostics passed
```

Useful checks:

```powershell
npm run build --prefix client
$env:NODE_ENV='test'; npm test --prefix server
```

## Current Limitations And Remaining Work

The core deployment path is ready, but the frontend still needs more work before it is considered polished for a final public release:

- Improve responsive visual design and accessibility testing across real devices.
- Add loading, retry, and offline states for network failures.
- Improve Google Sign-In configuration and production consent-screen readiness.
- Add rate limiting for login, password reset, and attendance endpoints.
- Return privacy-preserving responses for forgot-password requests.
- Add stronger session ownership checks to every protected session route.
- Add automated browser tests for login, Google verification, QR navigation, expiry, and CSV download.
- Add a custom production domain and monitor Render/Vercel logs.
- Consider migrating or backing up existing local/Atlas data before production use.

Do not use the system for official attendance until identity, location, security, privacy, and operational requirements have been reviewed for the institution using it.
