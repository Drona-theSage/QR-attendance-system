import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.js';
import { connectDb, disconnectDb } from '../src/db.js';
import { createAuthCookie, hashPassword } from '../src/auth.js';
import { AdminUser, Subject } from '../src/models.js';

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
