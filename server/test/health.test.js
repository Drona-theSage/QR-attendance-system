import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.js';

const server = app.listen(0);
const { port } = server.address();

test('health endpoint reports the API is running', async () => {
  const response = await fetch(`http://localhost:${port}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'qr-attendance-api' });
  server.close();
});
