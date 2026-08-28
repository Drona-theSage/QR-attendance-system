# QR Attendance System

This repository is being built incrementally as a learning project. It started as a local MVP for QR-based attendance and is now using MongoDB locally for durable sessions and attendance records. The project is deliberately being developed in phases so that each feature can be understood and tested before the next architectural step.

## Development Journey

### Phase 1: Define and build the MVP

The first goal was a small, working attendance loop:

1. An admin starts a short-lived attendance session.
2. The server creates a cryptographically random token and QR code.
3. A student opens the QR URL, enters a university email, and grants browser location access.
4. The server validates the session, email domain, GPS accuracy, distance, and duplicate submissions.
5. The admin sees attendance records while the session is active.

The initial stack was Express on the server and React/Vite in the browser. Sessions and records were kept in memory so the core workflow could be developed quickly without adding database setup too early.

### Phase 2: Test the MVP locally

The local MVP was tested through the browser and API. Because a QR code is only a URL, the student flow could also be tested in another browser tab by copying the student URL shown below the QR code.

The MVP included:

- Express API with security headers, CORS, and JSON request parsing.
- React/Vite admin and student interfaces.
- Temporary QR sessions with server-side expiry checks.
- Browser Geolocation API with high-accuracy mode.
- Server-side Haversine distance calculation and a 70-meter default radius.
- University email-domain validation.
- Poor GPS accuracy rejection above 200 meters.
- Duplicate attendance prevention for the same student and session.

### Phase 3: Fix issues found during local testing

The following bugs and usability problems were found and solved:

- Added a visible student URL and clipboard copy button below the QR code, making same-tab testing possible.
- Fixed university email validation so subdomains such as `devansh-mca26@cs.du.ac.in` are accepted when `cs.du.ac.in` is configured.
- Created local `server/.env` and `client/.env` files from the example configuration files.
- Diagnosed and cleared stale Node processes that caused ports 4000 and 5173 to conflict.
- Confirmed that the frontend can move to another Vite port when the default port is occupied.

### Phase 4: Add MongoDB locally

Once the MVP workflow was performing correctly, MongoDB was added without changing the browser API flow. Mongoose now provides models for subjects, attendance sessions, and attendance records. The server connects to the local database at startup using `MONGO_URI`, which defaults to:

```text
mongodb://127.0.0.1:27017/qr-attendance
```

The local MongoDB service was started and verified on port 27017. The API health endpoint and session creation flow were then checked with MongoDB connected. The old in-memory subject store remains temporarily for the sample/custom subject list and will be migrated in the next storage step.

### Phase 5: Current feature work

The session creation flow now supports:

- A separate course value alongside the subject.
- Existing sample subjects.
- Custom subject names entered by the admin.
- Optional custom subject codes.
- Course and subject details shown to students before check-in and after successful attendance.

### Phase 6: Next execution order

The agreed order from here is:

1. Add admin login authentication and protect admin routes.
2. Migrate subjects from the temporary store into MongoDB.
3. Build admin session history and attendance reporting.

Students will continue using the QR session link for now. Student accounts can be considered later if the project needs identity, enrolment, or attendance history beyond the current university email validation.

## Run It

Prerequisite: Node.js 20 or newer.

```powershell
npm install
npm run install:all
npm run dev
```

Open `http://localhost:5173`. The admin screen is the default page. Starting a session asks for the admin browser location and then displays the QR code. A student can open the generated QR URL, enter an address such as `student@university.ac.in`, and allow precise location access.

Copy the example environment files when you want to change defaults:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
```

Do not commit either `.env` file. The committed `.env.example` files contain configuration names only.

## How The Current System Works

1. The admin chooses an existing subject or enters a custom subject and course, then grants location permission.
2. `POST /api/admin/sessions` creates a random token, stores the session and admin coordinates in MongoDB, and generates a QR image containing the frontend attendance URL.
3. The student opens `/attendance/:token`. The frontend asks `GET /api/attendance/session/:token` whether the session still exists and is active.
4. The student submits email and browser coordinates to `POST /api/attendance/:token/mark`.
5. The server checks expiry, email domain, GPS accuracy, distance, and duplicates. The frontend never decides whether attendance is valid.
6. The admin polls the session endpoint every three seconds to show newly recorded students.

## Tests Performed

The server test suite was run after the MongoDB and custom session changes:

```powershell
$env:NODE_ENV='test'; npm test --prefix server
```

MongoDB must be running locally before the database-backed endpoint tests are executed. The MongoDB-backed test run completed successfully with the local service running.

The verified checks included:

- The health endpoint returns the expected API status.
- An admin session response includes a usable student URL.
- A QR response contains a PNG data URL.
- A session stores and returns its course.
- An admin can create a session with a custom subject and course.
- Haversine distance is zero for identical coordinates.
- A configured university subdomain accepts `devansh-mca26@cs.du.ac.in`.
- A non-university email is rejected.

The client source was also checked for diagnostics after the student course/subject display was added. The client build remains a separate useful check before frontend deployment.

## Useful Checks

```powershell
$env:NODE_ENV='test'; npm test --prefix server
npm run build --prefix client
```

The test suite will grow with authentication, protected-route, MongoDB subject, and reporting behavior.

## Important MVP Limitations

This version is for local learning only. Email text is not proof that a user owns the university account, and browser location can be inaccurate or manipulated. Admin routes are not protected yet, and subjects are not fully migrated to MongoDB. Do not use this version for official attendance. Proper admin authentication and authorization are the next security milestone.