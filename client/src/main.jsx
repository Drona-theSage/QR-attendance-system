import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// Vite replaces import.meta.env values during the frontend build.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function request(path, options = {}) {
  // A default parameter lets callers omit options; spread syntax merges request-specific settings.
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function useLocation() {
  // A custom hook groups reusable state and browser geolocation behavior.
  const [state, setState] = useState({
    loading: false,
    error: "",
    value: null,
  });

  function locate() {
    // setState replaces the previous object, so each location attempt starts cleanly.
    setState({ loading: true, error: "", value: null });

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setState({
          loading: false,
          error: "",
          value: {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
          },
        });
      },
      (error) => {
        setState({ loading: false, error: error.message, value: null });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  }

  return { ...state, locate };
}

async function downloadAttendance(token, sessionId) {
  // Blob represents binary response data, which can be turned into a browser download URL.
  const response = await fetch(`${API_URL}/admin/sessions/${token}/export`, {
    credentials: "include",
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Unable to download attendance.");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendance-${sessionId}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function HistorySummary({ history }) {
  // Destructuring props in the parameter gives direct access to the history value.
  if (!history || history.sessions.length === 0) {
    return (
      <section className="admin-history-panel">
        <h3>Session history</h3>
        <p className="muted">No sessions created yet.</p>
      </section>
    );
  }

  return (
    <section className="admin-history-panel">
      <h3>Session history</h3>
      <p className="muted">
        Total sessions: {history.totalSessions} · Total attendance:{" "}
        {history.totalAttendance}
      </p>
      <ul>
        {history.sessions.map((item) => (
          <li key={item.token}>
            <strong>{item.course}</strong> · {item.subject?.name || "Subject"} ·{" "}
            {item.attendanceCount} present
            <div className="muted">
              {new Date(item.createdAt).toLocaleString()} · {item.status}
            </div>
            {item.status === "expired" && (
              <button
                type="button"
                className="download-button"
                onClick={() =>
                  downloadAttendance(item.token, item.id).catch((err) =>
                    window.alert(err.message),
                  )
                }
              >
                Download attendance list
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Admin() {
  // useState returns [currentValue, setter]; calling the setter schedules a React re-render.
  const location = useLocation();
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState("");
  const [course, setCourse] = useState("");
  const [customSubjectName, setCustomSubjectName] = useState("");
  const [customSubjectCode, setCustomSubjectCode] = useState("");
  const [session, setSession] = useState(null);
  const [history, setHistory] = useState({
    totalSessions: 0,
    totalAttendance: 0,
    sessions: [],
  });
  const [error, setError] = useState("");

  async function logout() {
    await request("/auth/logout", { method: "POST" });
    window.location.assign("/");
  }

  async function deleteSubject(subjectIdToDelete) {
    try {
      await request(`/admin/subjects/${subjectIdToDelete}`, {
        method: "DELETE",
      });

      setSubjects((items) => {
        const nextItems = items.filter((item) => item.id !== subjectIdToDelete);
        setSubjectId((current) => {
          if (current === subjectIdToDelete) {
            return nextItems[0]?.id || "";
          }
          return current;
        });
        return nextItems;
      });
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    // An empty dependency array means this effect runs after the first render only.
    request("/subjects")
      .then((items) => {
        setSubjects(items);
        setSubjectId(items[0]?.id || "");
      })
      .catch((err) => setError(err.message));

    request("/admin/history")
      .then(setHistory)
      .catch(() =>
        setHistory({ totalSessions: 0, totalAttendance: 0, sessions: [] }),
      );
  }, []);

  async function startSession() {
    // async/await makes the sequence of location, API, and history operations readable.
    setError("");
    if (!location.value) {
      return location.locate();
    }

    const trimmedCourse = course.trim();
    const trimmedCustomSubject = customSubjectName.trim();

    if (!trimmedCourse) {
      setError("Please enter a course name before starting the session.");
      return;
    }

    if (!subjectId && !trimmedCustomSubject) {
      setError("Please choose a subject or create a custom subject.");
      return;
    }

    try {
      const payload = {
        course: trimmedCourse,
        ...location.value,
      };

      if (trimmedCustomSubject) {
        payload.subjectName = trimmedCustomSubject;
        payload.subjectCode = customSubjectCode.trim();
      } else {
        payload.subjectId = subjectId;
      }

      const createdSession = await request("/admin/sessions", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setSession(createdSession);
      const nextHistory = await request("/admin/history");
      setHistory(nextHistory);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="admin-console-page">
      <p className="eyebrow">MVP / ADMIN CONSOLE</p>
      <h1>Start attendance.</h1>
      <p className="page-intro">
        Create a short-lived QR session from the classroom location.
      </p>
      <button type="button" className="secondary-button" onClick={logout}>
        Log out
      </button>

      {!session ? (
        <>
          <section className="admin-session-setup-panel">
            <label>
              Course
              <input
                type="text"
                value={course}
                onChange={(event) => setCourse(event.target.value)}
                placeholder="e.g. BSc Computer Science"
              />
            </label>

            <label>
              Existing subject
              <select
                value={subjectId}
                onChange={(event) => setSubjectId(event.target.value)}
              >
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.code} · {subject.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Or create a custom subject
              <input
                type="text"
                value={customSubjectName}
                onChange={(event) => setCustomSubjectName(event.target.value)}
                placeholder="e.g. Advanced Web Development"
              />
            </label>

            <label>
              Custom subject code
              <input
                type="text"
                value={customSubjectCode}
                onChange={(event) => setCustomSubjectCode(event.target.value)}
                placeholder="e.g. AWD"
              />
            </label>

            <button onClick={startSession}>
              {location.loading ? "Getting location..." : "Start session"}
            </button>

            {location.error && (
              <p className="error">Location error: {location.error}</p>
            )}
            {error && <p className="error">{error}</p>}
          </section>
          <HistorySummary history={history} />
        </>
      ) : (
        <>
          <Session session={session} />
          <HistorySummary history={history} />
        </>
      )}
    </main>
  );
}

function Auth({ onAuthenticated }) {
  // JSX uses braces to insert JavaScript expressions into markup.
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [course, setCourse] = useState("");
  const [courseDuration, setCourseDuration] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    // Prevent the browser's full-page form submit so React keeps control of the UI.
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (mode === "forgot-password") {
        const response = await request("/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
        setSuccess(response.message || "Password reset link generated.");
        setMode("login");
        return;
      }

      // Object shorthand means { email: email, password: password }.
      const body = { email, password };
      if (mode === "register") {
        body.name = name;
        body.course = course;
        body.courseDuration = courseDuration;
      }
      const user = await request(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onAuthenticated(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const heading =
    mode === "login"
      ? "Welcome back."
      : mode === "register"
        ? "Create admin access."
        : "Reset your password.";
  const intro =
    mode === "login"
      ? "Sign in to create and monitor attendance sessions."
      : mode === "register"
        ? "Register as a class representative or session creator."
        : "Enter your email to receive a password reset link.";

  return (
    <main className="admin-auth-page">
      <p className="eyebrow">MVP / ADMIN ACCESS</p>
      <h1>{heading}</h1>
      <p className="page-intro">{intro}</p>

      <form
        className={`admin-auth-form-panel auth-panel ${mode === "register" ? "admin-registration-form" : "admin-login-form"}`}
        onSubmit={submit}
      >
        {mode === "register" && (
          <>
            <label>
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label>
              Course
              <input
                value={course}
                onChange={(event) => setCourse(event.target.value)}
                placeholder="e.g. BCA / MCA"
                required
              />
            </label>
            <label>
              Course duration
              <input
                value={courseDuration}
                onChange={(event) => setCourseDuration(event.target.value)}
                placeholder="e.g. 3 years / 2 semesters"
                required
              />
            </label>
          </>
        )}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        {mode !== "forgot-password" && (
          <label>
            Password
            <input
              type="password"
              minLength="8"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
        )}
        <button type="submit" disabled={loading}>
          {loading
            ? "Please wait..."
            : mode === "login"
              ? "Log in"
              : mode === "register"
                ? "Create account"
                : "Send reset link"}
        </button>
        {error && <p className="error">{error}</p>}
        {success && <p className="success">{success}</p>}
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMode(
              mode === "login"
                ? "register"
                : mode === "register"
                  ? "login"
                  : "login",
            );
            setError("");
            setSuccess("");
          }}
        >
          {mode === "login"
            ? "Signup"
            : mode === "register"
              ? "Back to admin login"
              : "Back to admin login"}
        </button>
        {mode === "login" && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setMode("forgot-password");
              setError("");
              setSuccess("");
            }}
          >
            Forgot password?
          </button>
        )}
      </form>
    </main>
  );
}

function ResetPassword() {
  // This component reads the one-time token from the URL query string.
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const token = new URLSearchParams(window.location.search).get("token");

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const response = await request("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setMessage(response.message || "Password updated successfully.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <main className="admin-reset-page">
        <p className="eyebrow">MVP / RESET PASSWORD</p>
        <section className="admin-reset-error-panel">
          <p className="error">This reset link is missing a valid token.</p>
          <a href="/" className="link-button">
            Return to login
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-reset-page">
      <p className="eyebrow">MVP / RESET PASSWORD</p>
      <h1>Set a new password.</h1>
      <form className="admin-reset-form-panel" onSubmit={submit}>
        <label>
          New password
          <input
            type="password"
            minLength="8"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "Please wait..." : "Update password"}
        </button>
        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}
        {message && (
          <a href="/" className="link-button">
            Back to login
          </a>
        )}
      </form>
    </main>
  );
}

function AdminGate() {
  // The gate decides whether to render the authenticated admin console or login screen.
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    request("/auth/me")
      .then(setUser)
      .catch(() => setUser(false))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <main className="admin-loading-page">
        <p className="page-intro">Checking admin access...</p>
      </main>
    );
  }
  return user ? <Admin /> : <Auth onAuthenticated={setUser} />;
}

function Session({ session }) {
  // The session component owns the countdown, attendance polling, QR, and manual-entry UI.
  const [remaining, setRemaining] = useState(
    Math.max(0, new Date(session.expiresAt) - Date.now()),
  );
  const [records, setRecords] = useState([]);
  const [copied, setCopied] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualRoll, setManualRoll] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualMessage, setManualMessage] = useState("");

  useEffect(() => {
    // setInterval repeats a callback; the cleanup function prevents timers after unmount.
    const timer = setInterval(() => {
      setRemaining(Math.max(0, new Date(session.expiresAt) - Date.now()));
    }, 1000);

    return () => clearInterval(timer);
  }, [session.expiresAt]);

  useEffect(() => {
    // Polling refreshes the list because the current app does not use WebSockets.
    const timer = setInterval(() => {
      request(`/admin/sessions/${session.token}`).then((data) => {
        setRecords(data.attendance);
      });
    }, 3000);

    return () => clearInterval(timer);
  }, [session.token]);

  async function copyStudentUrl() {
    try {
      await navigator.clipboard.writeText(session.studentUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      setCopied(false);
    }
  }

  async function submitManualAttendance(event) {
    event.preventDefault();
    setManualMessage("");

    try {
      await request(`/admin/sessions/${session.token}/manual-mark`, {
        method: "POST",
        body: JSON.stringify({
          studentName: manualName,
          classRollNumber: manualRoll,
          email: manualEmail,
        }),
      });
      setManualName("");
      setManualRoll("");
      setManualEmail("");
      const data = await request(`/admin/sessions/${session.token}`);
      setRecords(data.attendance);
    } catch (error) {
      setManualMessage(error.message);
    }
  }

  const minutes = String(Math.floor(remaining / 60000)).padStart(2, "0");
  const seconds = String(Math.floor(remaining / 1000) % 60).padStart(2, "0");

  return (
    <section className="admin-live-session-layout">
      <div className="admin-session-info-panel">
        <span className="status">{remaining ? "LIVE" : "EXPIRED"}</span>
        <h2>{session.subject.code}</h2>
        <p>{session.course}</p>
        <p>Session {session.id}</p>
        <div className="timer">
          {minutes}:{seconds}
        </div>
        <p className="muted">Students present: {records.length}</p>
        {!remaining && (
          <div className="session-actions">
            <button
              type="button"
              className="download-button"
              onClick={() =>
                downloadAttendance(session.token, session.id).catch((err) =>
                  window.alert(err.message),
                )
              }
            >
              Download attendance list
            </button>
            <button
              type="button"
              className="home-button"
              onClick={() => window.location.assign("/")}
            >
              Go to home
            </button>
          </div>
        )}
      </div>

      <div className="admin-qr-panel">
        <img src={session.qrDataUrl} alt="Attendance QR code" />
        <p>Students scan this code to check in.</p>

        <div className="student-url-box">
          <p className="url-label">Student link</p>
          <div className="url-row">
            <input readOnly value={session.studentUrl} className="url-input" />
            <button
              type="button"
              className="copy-button"
              onClick={copyStudentUrl}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      <div className="admin-manual-attendance-panel">
        <h3>Manual attendance</h3>
        <form onSubmit={submitManualAttendance}>
          <label>
            Student name
            <input
              value={manualName}
              onChange={(event) => setManualName(event.target.value)}
              required
            />
          </label>
          <label>
            Class roll number
            <input
              value={manualRoll}
              onChange={(event) => setManualRoll(event.target.value)}
              required
            />
          </label>
          <label>
            University email (optional for admin entry)
            <input
              type="email"
              value={manualEmail}
              onChange={(event) => setManualEmail(event.target.value)}
            />
          </label>
          <button type="submit">Add attendance manually</button>
        </form>
        {manualMessage && <p className="error">{manualMessage}</p>}
      </div>
    </section>
  );
}

function Student({ token }) {
  // The token comes from App's URL match and identifies the public attendance session.
  const location = useLocation();
  const googleButtonRef = useRef(null);
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [googleCredential, setGoogleCredential] = useState("");
  const [name, setName] = useState("");
  const [classRollNumber, setClassRollNumber] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    // The Google Client ID is public configuration; the server still verifies the token.
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId || !googleButtonRef.current) {
      return;
    }

    const renderGoogleButton = () => {
      if (!window.google?.accounts?.id || !googleButtonRef.current) {
        return;
      }
      // Google calls callback with a signed ID-token credential after successful sign-in.
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: ({ credential }) => {
          setGoogleCredential(credential);
          try {
            const payload = JSON.parse(atob(credential.split(".")[1]));
            setEmail(payload.email || "");
          } catch {
            setEmail("");
          }
        },
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        text: "signin_with",
        width: 320,
      });
    };

    if (window.google?.accounts?.id) {
      renderGoogleButton();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = renderGoogleButton;
    document.head.appendChild(script);
    return () => script.remove();
  }, []);

  // Load the public session details before enabling attendance submission.
  useEffect(() => {
    // Load public session details from the QR token before showing the form.
    request(`/attendance/session/${token}`)
      .then(setSession)
      .catch((err) => setMessage(err.message));
  }, [token]);

  async function markAttendance() {
    // The first click requests location; the next click submits the collected coordinates.
    setMessage("");

    if (!location.value) {
      return location.locate();
    }

    try {
      await request(`/attendance/${token}/mark`, {
        method: "POST",
        body: JSON.stringify({
          email,
          googleCredential,
          name,
          classRollNumber,
          ...location.value,
        }),
      });
      setDone(true);
    } catch (err) {
      setMessage(err.message);
    }
  }

  if (done) {
    return (
      <main className="student-attendance-success-page centered-page">
        <span className="check">✓</span>
        <h1>Attendance marked.</h1>
        <p className="page-intro">
          Your check-in was recorded for {session?.subject.name} in{" "}
          {session?.course}.
        </p>
      </main>
    );
  }

  return (
    <main className="student-attendance-page">
      <p className="eyebrow">MVP / STUDENT CHECK-IN</p>
      <h1>{session?.subject.code || "Attendance"}</h1>
      <p className="page-intro">
        {session
          ? "Review the attendance session details before checking in."
          : message || "Loading session..."}
      </p>

      {session && (
        <section
          className="student-session-summary"
          aria-label="Attendance session details"
        >
          <div>
            <span className="summary-label">Subject</span>
            <strong>{session.subject.name}</strong>
          </div>
          <div>
            <span className="summary-label">Course</span>
            <strong>{session.course}</strong>
          </div>
        </section>
      )}

      <section className="student-checkin-form-panel">
        <label>
          Full name
          <input
            type="text"
            placeholder="Enter your full name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label>
          Class roll number
          <input
            type="text"
            placeholder="e.g. 22MCA-14"
            value={classRollNumber}
            onChange={(event) => setClassRollNumber(event.target.value)}
          />
        </label>

        <div className="student-google-verification">
          <p className="student-google-label">
            Verify your university email with Google
          </p>
          <div ref={googleButtonRef} />
          {email && <p className="student-verified-email">Verified: {email}</p>}
        </div>

        <button
          disabled={
            !session || !googleCredential || !email || !name || !classRollNumber
          }
          onClick={markAttendance}
        >
          {location.loading ? "Getting location..." : "Mark attendance"}
        </button>

        {location.error && (
          <p className="error">
            Please allow precise browser location: {location.error}
          </p>
        )}
        {message && <p className="error">{message}</p>}
      </section>
    </main>
  );
}

function App() {
  // This small router reads the path and chooses the matching top-level React component.
  const path = window.location.pathname;
  const studentMatch = path.match(/^\/attendance\/([^/]+)/);
  const resetMatch = path.match(/^\/reset-password/);

  if (studentMatch) {
    return <Student token={studentMatch[1]} />;
  }

  if (resetMatch) {
    return <ResetPassword />;
  }

  return <AdminGate />;
}

createRoot(document.getElementById("root")).render(<App />);
