import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function request(path, options = {}) {
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
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    request('/subjects')
      .then((items) => {
        setSubjects(items);
        setSubjectId(items[0]?.id || '');
      })
      .catch((err) => setError(err.message));
  }, []);

  async function startSession() {
    setError('');
    if (!location.value) {
      return location.locate();
    }

    try {
      setSession(
        await request('/admin/sessions', {
          method: 'POST',
          body: JSON.stringify({ subjectId, ...location.value }),
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
            Subject
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
  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(
        Math.max(0, new Date(session.expiresAt) - Date.now()),
      );
    }, 1000);

    return () => clearInterval(timer);
  }, [session.expiresAt]);

  useEffect(() => {
    const timer = setInterval(() => {
      request(`/admin/sessions/${session.token}`).then((data) => {
        setRecords(data.attendance);
      });
    }, 3000);

    return () => clearInterval(timer);
  }, [session.token]);

  const minutes = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const seconds = String(Math.floor(remaining / 1000) % 60).padStart(2, '0');

  return (
    <section className="session-layout">
      <div className="panel session-info">
        <span className="status">{remaining ? 'LIVE' : 'EXPIRED'}</span>
        <h2>{session.subject.code}</h2>
        <p>Session {session.id}</p>
        <div className="timer">
          {minutes}:{seconds}
        </div>
        <p className="muted">Students present: {records.length}</p>
      </div>

      <div className="panel qr-panel">
        <img src={session.qrDataUrl} alt="Attendance QR code" />
        <p>Students scan this code to check in.</p>
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
      request(`/attendance/session/${token}`)
        .then(setSession)
        .catch((err) => setMessage(err.message));
   }, [token]);


  async function markAttendance() {
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
          Your check-in was recorded for {session?.subject.name}.
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
          ? `You are checking in for ${session.subject.name}.`
          : message || 'Loading session...'}
      </p>

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
