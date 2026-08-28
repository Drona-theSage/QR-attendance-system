import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceInMeters, isUniversityEmail } from '../src/utils.js';

test('distance is zero for identical coordinates', () => assert.equal(distanceInMeters(28.6139, 77.209, 28.6139, 77.209), 0));
test('university email validation accepts subdomain university addresses', () => {
  process.env.UNIVERSITY_EMAIL_DOMAIN = 'cs.du.ac.in';
  assert.equal(isUniversityEmail('devansh-mca26@cs.du.ac.in'), true);
  assert.equal(isUniversityEmail('student@du.ac.in'), true);
  assert.equal(isUniversityEmail('student@gmail.com'), false);
});
