import { Router } from "express";
import QRCode from "qrcode";
import { AttendanceRecord, AttendanceSession } from "./models.js";
import { addCustomSubject, subjects } from "./store.js";
import { createToken, distanceInMeters, isUniversityEmail } from "./utils.js";

const router = Router();

// Subjects are currently served from the temporary store until subject persistence is migrated.
router.get("/subjects", (_request, response) => response.json(subjects));

// Add a custom subject to the current subject catalog.
router.post("/admin/subjects", (request, response) => {
  const { name, code } = request.body;
  const subject = addCustomSubject(name, code);

  if (!subject) {
    return response.status(400).json({ error: "A subject name is required." });
  }

  return response.status(201).json(subject);
});

router.post("/admin/sessions", async (request, response) => {
  // Accept either a catalog subject ID or a new subject name from the admin form.
  const { subjectId, subjectName, subjectCode, course, latitude, longitude } = request.body;
  let subject = subjects.find((item) => item.id === subjectId);

  if (!subject && subjectName) {
    subject = addCustomSubject(subjectName, subjectCode);
  }

  if (!subject || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !course?.trim()) {
    return response
      .status(400)
      .json({ error: "A subject, course, and valid admin location are required." });
  }

  // Create the session token, expiry, and URL used by the student QR code.
  const token = createToken();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + Number(process.env.SESSION_EXPIRY_MINUTES || 5) * 60000,
  );
  const studentUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/attendance/${token}`;
  const sessionId = token.slice(0, 8).toUpperCase();

  // Persist the session before returning the QR payload to the admin.
  const session = await AttendanceSession.create({
    id: sessionId,
    token,
    subjectId: subject.id,
    subject,
    course: course.trim(),
    latitude,
    longitude,
    radius: Number(process.env.ATTENDANCE_RADIUS_METERS || 70),
    createdAt: now,
    expiresAt,
    status: "active",
  });

  const sessionPayload = session.toObject();
  return response.status(201).json({
    ...sessionPayload,
    studentUrl,
    qrDataUrl: await QRCode.toDataURL(studentUrl),
  });
});

router.get("/admin/sessions/:token", async (request, response) => {
  // The admin view uses this endpoint to refresh the current attendance list.
  const session = await AttendanceSession.findOne({ token: request.params.token }).lean();
  if (!session)
    return response.status(404).json({ error: "Session not found." });

  const records = await AttendanceRecord.find({ sessionToken: session.token }).lean();
  return response.json({
    ...session,
    status: new Date() >= new Date(session.expiresAt) ? "expired" : session.status,
    attendance: records,
  });
});

router.post("/admin/sessions/:token/end", async (request, response) => {
  const session = await AttendanceSession.findOne({ token: request.params.token });
  if (!session)
    return response.status(404).json({ error: "Session not found." });

  session.status = "ended";
  await session.save();
  return response.json(session.toObject());
});

router.get("/attendance/session/:token", async (request, response) => {
  // Students receive only the public session details needed to check in.
  const session = await AttendanceSession.findOne({ token: request.params.token }).lean();
  if (!session)
    return response.status(404).json({ error: "QR session not found." });
  if (session.status !== "active" || new Date() >= new Date(session.expiresAt))
    return response
      .status(410)
      .json({ error: "This attendance session has expired or ended." });
  return response.json({
    id: session.id,
    subject: session.subject,
    course: session.course,
    expiresAt: session.expiresAt,
    radius: session.radius,
  });
});

router.post("/attendance/:token/mark", async (request, response) => {
  // Validate every attendance condition on the server; the browser is not trusted.
  const session = await AttendanceSession.findOne({ token: request.params.token });
  const { email, latitude, longitude, accuracy } = request.body;
  if (!session)
    return response.status(404).json({ error: "QR session not found." });
  if (session.status !== "active" || new Date() >= new Date(session.expiresAt))
    return response
      .status(410)
      .json({ error: "This attendance session has expired or ended." });
  if (!isUniversityEmail(email))
    return response
      .status(403)
      .json({ error: "Use your university email address." });
  if (![latitude, longitude, accuracy].every(Number.isFinite))
    return response
      .status(400)
      .json({ error: "Valid location data is required." });
  if (accuracy > 200)
    return response
      .status(422)
      .json({
        error:
          "Location accuracy is too poor. Enable precise location and try again.",
      });

  const distance = distanceInMeters(
    session.latitude,
    session.longitude,
    latitude,
    longitude,
  );
  if (distance > session.radius)
    return response
      .status(422)
      .json({
        error: `You are outside the ${session.radius} meter attendance radius.`,
      });

  const existingRecord = await AttendanceRecord.findOne({
    sessionToken: session.token,
    studentEmail: email.toLowerCase(),
  });

  if (existingRecord)
    return response
      .status(409)
      .json({ error: "Attendance is already marked for this student." });

  const record = await AttendanceRecord.create({
    sessionToken: session.token,
    studentEmail: email.toLowerCase(),
    subject: session.subject.name,
    latitude,
    longitude,
    accuracy,
    distance: Math.round(distance),
    status: "present",
    timestamp: new Date(),
  });

  return response.status(201).json(record.toObject());
});

export default router;
