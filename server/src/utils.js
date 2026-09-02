import crypto from "node:crypto";

export function createToken() {
  // randomBytes creates unpredictable data; hex makes it safe to place in a URL.
  return crypto.randomBytes(24).toString("hex");
}

export function distanceInMeters(
  firstLatitude,
  firstLongitude,
  secondLatitude,
  secondLongitude,
) {
  // The Haversine formula measures the shortest surface distance between coordinates.
  const earthRadius = 6371000;
  // JavaScript trigonometric functions use radians, so coordinates are converted first.
  const toRadians = (degrees) => degrees * (Math.PI / 180);
  const latitudeDifference = toRadians(secondLatitude - firstLatitude);
  const longitudeDifference = toRadians(secondLongitude - firstLongitude);
  const firstLatitudeRadians = toRadians(firstLatitude);
  const secondLatitudeRadians = toRadians(secondLatitude);
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(firstLatitudeRadians) *
      Math.cos(secondLatitudeRadians) *
      Math.sin(longitudeDifference / 2) ** 2;
  return (
    earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function isUniversityEmail(email) {
  // The server checks domain membership, while Google verification checks account ownership.
  const domain = process.env.UNIVERSITY_EMAIL_DOMAIN || "university.ac.in";
  const domainParts = domain.split(".").filter(Boolean);
  const acceptedDomains = new Set([domain]);

  for (let index = 1; index < domainParts.length; index += 1) {
    acceptedDomains.add(domainParts.slice(index).join("."));
  }

  const escapedDomains = [...acceptedDomains].map((acceptedDomain) =>
    acceptedDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );

  return new RegExp(
    `^[^@\\s]+@(?:[A-Za-z0-9-]+\\.)*(?:${escapedDomains.join("|")})$`,
    "i",
  ).test(email);
}
