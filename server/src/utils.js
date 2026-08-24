import crypto from 'node:crypto';

export function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function distanceInMeters(firstLatitude, firstLongitude, secondLatitude, secondLongitude) {
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
  const domain = process.env.UNIVERSITY_EMAIL_DOMAIN || 'university.ac.in';
  return new RegExp(`^[^@\\s]+@${domain.replace('.', '\\.')}$`, 'i').test(email);
}
