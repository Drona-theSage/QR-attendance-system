import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.js';
import { connectDb, disconnectDb } from '../src/db.js';

test.before(async () => {
  await connectDb();
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

test('health endpoint reports the API is running', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`http://localhost:${port}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'qr-attendance-api' });
});

test('admin session response includes a student URL for testing', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`http://localhost:${port}/api/admin/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subjectId: 'dbms',
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
    headers: { 'Content-Type': 'application/json' },
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
