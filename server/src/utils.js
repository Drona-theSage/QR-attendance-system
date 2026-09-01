import crypto from 'node:crypto';

export function createToken() {
  // A random token prevents students from guessing another active session URL.
  return crypto.randomBytes(24).toString('hex');
}

export function distanceInMeters(firstLatitude, firstLongitude, secondLatitude, secondLongitude) {
  // Haversine distance converts two latitude/longitude pairs into meters.
  const earthRadius = 6371000;
  const toRadians = (degrees) => degrees * (Math.PI / 180);
  const latitudeDifference = toRadians(secondLatitude - firstLatitude);
  const longitudeDifference = toRadians(secondLongitude - firstLongitude);
  const firstLatitudeRadians = toRadians(firstLatitude);
  const secondLatitudeRadians = toRadians(secondLatitude);
  const haversine = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(firstLatitudeRadians) * Math.cos(secondLatitudeRadians)
    * Math.sin(longitudeDifference / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function isUniversityEmail(email) {
  // Accept the configured university domain and its academic parent domains.
  const domain = process.env.UNIVERSITY_EMAIL_DOMAIN || 'university.ac.in';
  const domainParts = domain.split('.').filter(Boolean);
  const acceptedDomains = new Set([domain]);

  for (let index = 1; index < domainParts.length; index += 1) {
    acceptedDomains.add(domainParts.slice(index).join('.'));
  }

  const escapedDomains = [...acceptedDomains].map((acceptedDomain) => (
    acceptedDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ));

  return new RegExp(
    `^[^@\\s]+@(?:[A-Za-z0-9-]+\\.)*(?:${escapedDomains.join('|')})$`,
    'i',
  ).test(email);
}
