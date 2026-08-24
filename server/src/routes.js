import { Router } from 'express';
import QRCode from 'qrcode';
import { attendance, sessions, subjects } from './store.js';
import { createToken, distanceInMeters, isUniversityEmail } from './utils.js';

const router = Router();

router.get('/subjects', (_request, response) => response.json(subjects));

router.post('/admin/sessions', async (request, response) => {
  const { subjectId, latitude, longitude } = request.body;
  const subject = subjects.find((item) => item.id === subjectId);
  if (!subject || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return response.status(400).json({ error: 'A subject and valid admin location are required.' });
  }

  const token = createToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Number(process.env.SESSION_EXPIRY_MINUTES || 5) * 60000);
  const session = {
    id: token.slice(0, 8).toUpperCase(), token, subject, latitude, longitude,
    radius: Number(process.env.ATTENDANCE_RADIUS_METERS || 70), createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(), status: 'active'
  };
  sessions.set(token, session);
  return response.status(201).json({ ...session, qrDataUrl: await QRCode.toDataURL(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/attendance/${token}`) });
});

router.get('/admin/sessions/:token', (request, response) => {
  const session = sessions.get(request.params.token);
  if (!session) return response.status(404).json({ error: 'Session not found.' });
  const records = [...attendance.values()].filter((record) => record.sessionToken === session.token);
  return response.json({ ...session, status: new Date() >= new Date(session.expiresAt) ? 'expired' : session.status, attendance: records });
});

router.post('/admin/sessions/:token/end', (request, response) => {
  const session = sessions.get(request.params.token);
  if (!session) return response.status(404).json({ error: 'Session not found.' });
  session.status = 'ended';
  return response.json(session);
});

router.get('/attendance/session/:token', (request, response) => {
  const session = sessions.get(request.params.token);
  if (!session) return response.status(404).json({ error: 'QR session not found.' });
  if (session.status !== 'active' || new Date() >= new Date(session.expiresAt)) return response.status(410).json({ error: 'This attendance session has expired or ended.' });
  return response.json({ id: session.id, subject: session.subject, expiresAt: session.expiresAt, radius: session.radius });
});

router.post('/attendance/:token/mark', (request, response) => {
  const session = sessions.get(request.params.token);
  const { email, latitude, longitude, accuracy } = request.body;
  if (!session) return response.status(404).json({ error: 'QR session not found.' });
  if (session.status !== 'active' || new Date() >= new Date(session.expiresAt)) return response.status(410).json({ error: 'This attendance session has expired or ended.' });
  if (!isUniversityEmail(email)) return response.status(403).json({ error: 'Use your university email address.' });
  if (![latitude, longitude, accuracy].every(Number.isFinite)) return response.status(400).json({ error: 'Valid location data is required.' });
  if (accuracy > 200) return response.status(422).json({ error: 'Location accuracy is too poor. Enable precise location and try again.' });

  const distance = distanceInMeters(session.latitude, session.longitude, latitude, longitude);
  if (distance > session.radius) return response.status(422).json({ error: `You are outside the ${session.radius} meter attendance radius.` });
  const studentKey = `${session.token}:${email.toLowerCase()}`;
  if (attendance.has(studentKey)) return response.status(409).json({ error: 'Attendance is already marked for this student.' });

  const record = { sessionToken: session.token, studentEmail: email.toLowerCase(), subject: session.subject.name, timestamp: new Date().toISOString(), latitude, longitude, accuracy, distance: Math.round(distance), status: 'present' };
  attendance.set(studentKey, record);
  return response.status(201).json(record);
});

export default router;
