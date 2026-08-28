import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function request(path, options = {}) {
  // Keep API calls consistent and turn server errors into user-facing messages.
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function useLocation() {
  const [state, setState] = useState({
    loading: false,
    error: '',
    value: null,
  });

  function locate() {
    // Location is requested only after the user begins an admin or student action.
    setState({ loading: true, error: '', value: null });

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setState({
          loading: false,
          error: '',
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

function Admin() {
  const location = useLocation();
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState('');
  const [course, setCourse] = useState('');
  const [customSubjectName, setCustomSubjectName] = useState('');
  const [customSubjectCode, setCustomSubjectCode] = useState('');
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // Load the current subject catalog when the admin page opens.
    request('/subjects')
      .then((items) => {
        setSubjects(items);
        setSubjectId(items[0]?.id || '');
      })
      .catch((err) => setError(err.message));
  }, []);

  async function startSession() {
    // First obtain the admin location, then submit the session configuration.
    setError('');
    if (!location.value) {
      return location.locate();
    }

    const trimmedCourse = course.trim();
    const trimmedCustomSubject = customSubjectName.trim();

    if (!trimmedCourse) {
      setError('Please enter a course name before starting the session.');
      return;
    }

    if (!subjectId && !trimmedCustomSubject) {
      setError('Please choose a subject or create a custom subject.');
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

      setSession(
        await request('/admin/sessions', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      );
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="shell">
      <p className="eyebrow">MVP / ADMIN CONSOLE</p>
      <h1>Start attendance.</h1>
      <p className="intro">
        Create a short-lived QR session from the classroom location.
      </p>

      {!session ? (
        <section className="panel">
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
            {location.loading ? 'Getting location...' : 'Start session'}
          </button>

          {location.error && (
            <p className="error">Location error: {location.error}</p>
          )}
          {error && <p className="error">{error}</p>}
        </section>
      ) : (
        <Session session={session} />
      )}
    </main>
  );
}

function Session({ session }) {
  const [remaining, setRemaining] = useState(Math.max(0, new Date(session.expiresAt) - Date.now()));
  const [records, setRecords] = useState([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Keep the countdown synchronized with the server-provided expiry time.
    const timer = setInterval(() => {
      setRemaining(
        Math.max(0, new Date(session.expiresAt) - Date.now()),
      );
    }, 1000);

    return () => clearInterval(timer);
  }, [session.expiresAt]);

  useEffect(() => {
    // Poll while the session is open so the admin sees new attendance records.
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

  const minutes = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const seconds = String(Math.floor(remaining / 1000) % 60).padStart(2, '0');

  return (
    <section className="session-layout">
      <div className="panel session-info">
        <span className="status">{remaining ? 'LIVE' : 'EXPIRED'}</span>
        <h2>{session.subject.code}</h2>
        <p>{session.course}</p>
        <p>Session {session.id}</p>
        <div className="timer">
          {minutes}:{seconds}
        </div>
        <p className="muted">Students present: {records.length}</p>
      </div>

      <div className="panel qr-panel">
        <img src={session.qrDataUrl} alt="Attendance QR code" />
        <p>Students scan this code to check in.</p>

        <div className="student-url-box">
          <p className="url-label">Student link</p>
          <div className="url-row">
            <input readOnly value={session.studentUrl} className="url-input" />
            <button type="button" className="copy-button" onClick={copyStudentUrl}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Student({ token }) {
  const location = useLocation();
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Load public session details from the QR token before showing the form.
      request(`/attendance/session/${token}`)
        .then(setSession)
        .catch((err) => setMessage(err.message));
   }, [token]);


  async function markAttendance() {
    // Request location first, then send the student's email and coordinates to the server.
    setMessage('');

    if (!location.value) {
      return location.locate();
    }

    try {
      await request(`/attendance/${token}/mark`, {
        method: 'POST',
        body: JSON.stringify({ email, ...location.value }),
      });
      setDone(true);
    } catch (err) {
      setMessage(err.message);
    }
  }

  if (done) {
    return (
      <main className="shell center">
        <span className="check">✓</span>
        <h1>Attendance marked.</h1>
        <p className="intro">
          Your check-in was recorded for {session?.subject.name} in {session?.course}.
        </p>
      </main>
    );
  }

  return (
    <main className="shell">
      <p className="eyebrow">MVP / STUDENT CHECK-IN</p>
      <h1>{session?.subject.code || 'Attendance'}</h1>
      <p className="intro">
        {session
          ? 'Review the attendance session details before checking in.'
          : message || 'Loading session...'}
      </p>

      {session && (
        <section className="session-summary" aria-label="Attendance session details">
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

      <section className="panel">
        <label>
          University email
          <input
            type="email"
            placeholder="you@university.ac.in"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <button
          disabled={!session || !email}
          onClick={markAttendance}
        >
          {location.loading ? 'Getting location...' : 'Mark attendance'}
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
  const path = window.location.pathname;
  const match = path.match(/^\/attendance\/([^/]+)/);

  return match ? <Student token={match[1]} /> : <Admin />;
}

createRoot(document.getElementById('root')).render(
  <App />,
);
