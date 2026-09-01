import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.js';
import { connectDb, disconnectDb } from '../src/db.js';
import { createAuthCookie, hashPassword } from '../src/auth.js';
import { AdminUser, AttendanceRecord, Subject } from '../src/models.js';

let adminCookie;

test.before(async () => {
  await connectDb();
});

test.beforeEach(async () => {
  await Subject.deleteMany({});
  await AdminUser.deleteMany({});
  const user = await AdminUser.create({
    name: 'Test Admin',
    email: 'admin@example.com',
    passwordHash: await hashPassword('correct horse battery staple'),
    course: 'MCA',
    courseDuration: '2 years',
  });
  adminCookie = createAuthCookie(user.id);
});

test.after(async () => {
  await disconnectDb();
});

async function startServer() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, port };
}

test('registration requires course and course duration', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`http://localhost:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Incomplete Admin',
      email: 'incomplete@example.com',
      password: 'strong password',
    }),
  });

  assert.equal(response.status, 400);
  const json = await response.json();
  assert.match(json.error, /course/i);
});

test('health endpoint reports the API is running', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`http://localhost:${port}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'qr-attendance-api' });
});

test('admin session routes reject unauthenticated requests', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`http://localhost:${port}/api/admin/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subjectId: 'dbms', course: 'MCA', latitude: 28.6139, longitude: 77.209 }),
  });

  assert.equal(response.status, 401);
});

test('new admin starts with an empty subject catalog', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const registerResponse = await fetch(`http://localhost:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Fresh Admin',
      email: 'fresh@example.com',
      password: 'strong password',
      course: 'BCA',
      courseDuration: '3 years',
    }),
  });

  assert.equal(registerResponse.status, 201);
  const cookie = registerResponse.headers.get('set-cookie');
  const subjectsResponse = await fetch(`http://localhost:${port}/api/subjects`, {
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
  });

  assert.equal(subjectsResponse.status, 200);
  assert.deepEqual(await subjectsResponse.json(), []);
});

test('admin login returns an httpOnly authentication cookie', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`http://localhost:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'correct horse battery staple',
    }),
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') || '', /HttpOnly/);
  assert.deepEqual(await response.json(), {
    id: (await AdminUser.findOne({ email: 'admin@example.com' })).id,
    name: 'Test Admin',
    email: 'admin@example.com',
    role: 'admin',
    course: 'MCA',
    courseDuration: '2 years',
  });
});

test('admin can request a password reset link for a registered email', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`http://localhost:${port}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com' }),
  });

  assert.equal(response.status, 200);
  const json = await response.json();
  assert.match(json.message, /reset/i);
  assert.match(json.resetUrl || '', /token=/i);

  const user = await AdminUser.findOne({ email: 'admin@example.com' });
  assert.ok(user.resetToken);
  assert.ok(user.resetTokenExpiresAt > new Date());
});

test('admin can reset password with a valid reset token', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const forgotResponse = await fetch(`http://localhost:${port}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com' }),
  });

  assert.equal(forgotResponse.status, 200);
  const forgotJson = await forgotResponse.json();
  const token = new URL(forgotJson.resetUrl).searchParams.get('token');

  const resetResponse = await fetch(`http://localhost:${port}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      password: 'new secure password',
    }),
  });

  assert.equal(resetResponse.status, 200);
  const updatedUser = await AdminUser.findOne({ email: 'admin@example.com' });
  assert.equal(updatedUser.resetToken, null);
  assert.equal(updatedUser.resetTokenExpiresAt, null);

  const loginResponse = await fetch(`http://localhost:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'new secure password',
    }),
  });

  assert.equal(loginResponse.status, 200);
});

test('multiple people can register admin accounts for different courses', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`http://localhost:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Second Session Creator',
      email: 'cr-two@example.com',
      password: 'another secure password',
      course: 'BSc',
      courseDuration: '3 years',
    }),
  });

  assert.equal(response.status, 201);
  assert.match(response.headers.get('set-cookie') || '', /HttpOnly/);
  assert.equal(await AdminUser.countDocuments(), 2);
});

test('same email cannot be reused for a different course', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`http://localhost:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Course Reuse Attempt',
      email: 'admin@example.com',
      password: 'another secure password',
      course: 'BTech',
      courseDuration: '4 years',
    }),
  });

  assert.equal(response.status, 409);
  const json = await response.json();
  assert.match(json.error, /different course|new email/i);
});

test('admin session response includes a student URL for testing', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const subjectResponse = await fetch(`http://localhost:${port}/api/admin/subjects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'Database Management Systems', code: 'DBMS' }),
  });

  assert.equal(subjectResponse.status, 201);
  const subject = await subjectResponse.json();

  const response = await fetch(`http://localhost:${port}/api/admin/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      subjectId: subject.id,
      course: 'MCA Semester 2',
      latitude: 28.6139,
      longitude: 77.209,
    }),
  });

  assert.equal(response.status, 201);
  const json = await response.json();
  assert.ok(json.studentUrl.includes('/attendance/'));
  assert.ok(json.qrDataUrl.startsWith('data:image/png;base64,'));
  assert.equal(json.course, 'MCA Semester 2');
});

test('admin can create a custom subject and course for a session', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`http://localhost:${port}/api/admin/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      subjectName: 'Research Methodology',
      subjectCode: 'RM',
      course: 'MCA Semester 4',
      latitude: 28.6139,
      longitude: 77.209,
    }),
  });

  assert.equal(response.status, 201);
  const json = await response.json();
  assert.equal(json.subject.name, 'Research Methodology');
  assert.equal(json.course, 'MCA Semester 4');
});

test('subjects are scoped to the admin and persist per course', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const listResponse = await fetch(`http://localhost:${port}/api/subjects`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(listResponse.status, 200);
  assert.deepEqual(await listResponse.json(), []);

  const createResponse = await fetch(`http://localhost:${port}/api/admin/subjects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'Machine Learning', code: 'ML' }),
  });

  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.name, 'Machine Learning');

  const refreshed = await fetch(`http://localhost:${port}/api/subjects`, {
    headers: { Cookie: adminCookie },
  });

  assert.equal(refreshed.status, 200);
  const refreshedSubjects = await refreshed.json();
  assert.ok(refreshedSubjects.some((subject) => subject.name === 'Machine Learning'));
  assert.equal(await Subject.countDocuments({ adminId: (await AdminUser.findOne({ email: 'admin@example.com' }))._id }), 1);
});

test('student attendance requires name and class roll number', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const createSubject = await fetch(`http://localhost:${port}/api/admin/subjects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'Identity Subject', code: 'IS' }),
  });

  const subject = await createSubject.json();
  const session = await fetch(`http://localhost:${port}/api/admin/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      subjectId: subject.id,
      course: 'MCA Identity',
      latitude: 28.6139,
      longitude: 77.209,
    }),
  });

  const sessionJson = await session.json();

  const response = await fetch(`http://localhost:${port}/api/attendance/${sessionJson.token}/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'student@university.ac.in',
      latitude: 28.6139,
      longitude: 77.209,
      accuracy: 10,
    }),
  });

  assert.equal(response.status, 400);
  const json = await response.json();
  assert.match(json.error, /name.*roll|roll.*name/i);
});

test('student attendance records name and roll number for export', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const createSubject = await fetch(`http://localhost:${port}/api/admin/subjects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'Export Subject', code: 'ES' }),
  });

  const subject = await createSubject.json();
  const session = await fetch(`http://localhost:${port}/api/admin/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      subjectId: subject.id,
      course: 'MCA Export',
      latitude: 28.6139,
      longitude: 77.209,
    }),
  });

  const sessionJson = await session.json();

  const response = await fetch(`http://localhost:${port}/api/attendance/${sessionJson.token}/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'student@university.ac.in',
      name: 'Ananya Sharma',
      classRollNumber: '22MCA-14',
      latitude: 28.6139,
      longitude: 77.209,
      accuracy: 10,
    }),
  });

  assert.equal(response.status, 201);
  const json = await response.json();
  assert.equal(json.studentName, 'Ananya Sharma');
  assert.equal(json.studentRollNumber, '22MCA-14');
  assert.equal(json.studentEmail, 'student@university.ac.in');
});

test('admin can delete a subject entry', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const createSubject = await fetch(`http://localhost:${port}/api/admin/subjects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'Delete Subject', code: 'DS' }),
  });

  assert.equal(createSubject.status, 201);
  const subject = await createSubject.json();

  const response = await fetch(`http://localhost:${port}/api/admin/subjects/${subject.id}`, {
    method: 'DELETE',
    headers: { Cookie: adminCookie },
  });

  assert.equal(response.status, 200);
  assert.equal(await Subject.countDocuments({ id: subject.id }), 0);
});

test('admin can add a student attendance manually', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const createSubject = await fetch(`http://localhost:${port}/api/admin/subjects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'Manual Subject', code: 'MS' }),
  });

  const subject = await createSubject.json();
  const session = await fetch(`http://localhost:${port}/api/admin/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      subjectId: subject.id,
      course: 'Manual Session',
      latitude: 28.6139,
      longitude: 77.209,
    }),
  });

  const sessionJson = await session.json();
  const response = await fetch(`http://localhost:${port}/api/admin/sessions/${sessionJson.token}/manual-mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      studentName: 'Manual Student',
      classRollNumber: 'MS-01',
      email: 'manual@student.university.ac.in',
    }),
  });

  assert.equal(response.status, 201);
  const json = await response.json();
  assert.equal(json.studentName, 'Manual Student');
  assert.equal(json.studentRollNumber, 'MS-01');
});

test('admin can fetch session history and summary details', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const subjectResponse = await fetch(`http://localhost:${port}/api/admin/subjects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'Report Subject', code: 'RS' }),
  });

  assert.equal(subjectResponse.status, 201);
  const subject = await subjectResponse.json();

  const firstSession = await fetch(`http://localhost:${port}/api/admin/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      subjectId: subject.id,
      course: 'MCA Report Course',
      latitude: 28.6139,
      longitude: 77.209,
    }),
  });

  assert.equal(firstSession.status, 201);
  const session = await firstSession.json();

  await AttendanceRecord.create({
    sessionToken: session.token,
    studentEmail: 'student1@example.com',
    subject: subject.name,
    latitude: 28.6139,
    longitude: 77.209,
    accuracy: 10,
    distance: 8,
    status: 'present',
    timestamp: new Date(),
  });

  await AttendanceRecord.create({
    sessionToken: session.token,
    studentEmail: 'student2@example.com',
    subject: subject.name,
    latitude: 28.6139,
    longitude: 77.209,
    accuracy: 10,
    distance: 9,
    status: 'present',
    timestamp: new Date(),
  });

  const historyResponse = await fetch(`http://localhost:${port}/api/admin/history`, {
    headers: { Cookie: adminCookie },
  });

  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.equal(history.totalSessions, 1);
  assert.equal(history.totalAttendance, 2);
  assert.equal(history.sessions[0].attendanceCount, 2);
  assert.equal(history.sessions[0].course, 'MCA Report Course');
  assert.ok(history.sessions[0].studentUrl.includes('/attendance/'));
});
