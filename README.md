# QR Attendance System

This repository is being built incrementally as a learning project. The current stage is a runnable MVP for creating a temporary attendance session and marking attendance with a QR code plus browser location.

## MVP Scope

Included now:

- Express API with security headers, CORS, and JSON request parsing.
- React/Vite browser interface for the admin and student flows.
- Two sample subjects.
- Cryptographically random, five-minute QR sessions.
- Server-side session expiry checks.
- Browser Geolocation API with high-accuracy mode.
- Server-side Haversine distance calculation and a 70-meter default radius.
- University email-domain validation.
- Poor GPS accuracy rejection above 200 meters.
- Duplicate attendance prevention for the same student and session.

Intentionally postponed:

- MongoDB persistence. Data currently lives in memory and disappears when the server restarts.
- Real Google OAuth. The MVP accepts a university email as a learning placeholder; this is not production authentication.
- WebAuthn/passkey device binding. A normal browser cannot expose a reliable MAC address, so this advanced anti-proxy feature will be designed separately.
- Admin authorization, exports, Socket.IO updates, rate limiting, and production deployment hardening.

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

## How The MVP Works

1. The admin chooses a subject and grants location permission.
2. `POST /api/admin/sessions` creates a random token, stores the admin coordinates temporarily, and generates a QR image containing the frontend attendance URL.
3. The student opens `/attendance/:token`. The frontend asks `GET /api/attendance/session/:token` whether the session still exists and is active.
4. The student submits email and browser coordinates to `POST /api/attendance/:token/mark`.
5. The server checks expiry, email domain, GPS accuracy, distance, and duplicates. The frontend never decides whether attendance is valid.
6. The admin polls the session endpoint every three seconds to show newly recorded students.

The temporary store in `server/src/store.js` has the same conceptual separation that the later MongoDB models will use. In the MongoDB stage, these Maps will be replaced with Mongoose models and database indexes, without changing the browser flow.

## Useful Checks

```powershell
$env:NODE_ENV='test'; npm test --prefix server
npm run build --prefix client
```

The tests currently cover the health endpoint, zero-distance Haversine behavior, and university email validation. More endpoint tests will be added before the MongoDB stage.

## Important MVP Limitations

This version is for local learning only. Email text is not proof that a user owns the university account, in-memory records are not durable, and the browser location can be inaccurate or manipulated. Do not use this version for official attendance. The next stage should add MongoDB persistence and proper authentication before treating the application as trusted.