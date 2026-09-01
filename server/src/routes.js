import { Router } from "express";
import QRCode from "qrcode";
import { AdminUser, AttendanceRecord, AttendanceSession, Subject } from "./models.js";
import { clearAuthCookie, createAuthCookie, hashPassword, requireAdmin, verifyPassword } from "./auth.js";
import { createToken, distanceInMeters, isUniversityEmail } from "./utils.js";

const router = Router();

async function getSubjectCatalog(adminUserId, course) {
  return Subject.find({ adminId: adminUserId, course }).sort({ name: 1 }).lean();
}

async function addCustomSubject(adminUserId, course, name, code = "") {
  const trimmedName = String(name || "").trim();
  const trimmedCode = String(code || trimmedName).trim();

  if (!trimmedName) {
    return null;
  }

  const existing = await Subject.findOne({
    adminId: adminUserId,
    course,
    name: { $regex: new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
  });

  if (existing) {
    return existing.toObject();
  }

  const subject = await Subject.create({
    adminId: adminUserId,
    course,
    id: `custom-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: trimmedName,
    code: trimmedCode.toUpperCase().slice(0, 12) || "CUST",
  });

  return subject.toObject();
}


//register route
router.post("/auth/register", async (request, response) => {
  const { name, email, password, course, courseDuration } = request.body;
  const normalizedEmail = email?.trim().toLowerCase();
  const normalizedCourse = course?.trim();
  const normalizedDuration = courseDuration?.trim();

  if (!name?.trim() || !normalizedEmail || !password || password.length < 8 || !normalizedCourse || !normalizedDuration) {
    return response.status(400).json({ error: "Name, email, course, course duration, and a password of at least 8 characters are required." });
  }

  try {
    const existingUser = await AdminUser.findOne({ email: normalizedEmail }).lean();
    if (existingUser && existingUser.course && existingUser.course.toLowerCase() !== normalizedCourse.toLowerCase()) {
      return response.status(409).json({
        error: "This email is already mapped to a different course. Please use a new email or delete your previous account to use this email again.",
      });
    }

    if (existingUser && existingUser.course && existingUser.course.toLowerCase() === normalizedCourse.toLowerCase()) {
      return response.status(409).json({ error: "An account with this email already exists for this course." });
    }

    const user = await AdminUser.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await hashPassword(password),
      course: normalizedCourse,
      courseDuration: normalizedDuration,
    });
    response.setHeader("Set-Cookie", createAuthCookie(user.id));
    return response.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      course: user.course,
      courseDuration: user.courseDuration,
    });
  } catch (error) {
    if (error.code === 11000) {
      return response.status(409).json({ error: "An account with this email already exists." });
    }
    throw error;
  }
});


//login route
router.post("/auth/login", async (request, response) => {
  const normalizedEmail = request.body.email?.trim().toLowerCase();
  const user = await AdminUser.findOne({ email: normalizedEmail });

  //check if user exists and verify the password with hashed password saved in db , otherwise throw error.
  if (!user || !await verifyPassword(request.body.password || "", user.passwordHash)) {
    return response.status(401).json({ error: "Invalid email or password." });
  }
   

  //if user is authenticated generate a cookie for the login session in the browser.
  response.setHeader("Set-Cookie", createAuthCookie(user.id));
  return response.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    course: user.course,
    courseDuration: user.courseDuration,
  });
});


//authenticate self route
router.get("/auth/me", requireAdmin, async (request, response) => {
  const user = await AdminUser.findById(request.adminUserId).lean();

  if (!user) {
    response.setHeader("Set-Cookie", clearAuthCookie());
    return response.status(401).json({ error: "Admin login required." });
  }
  return response.json({
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    course: user.course,
    courseDuration: user.courseDuration,
  });
});


//logout route
router.post("/auth/logout", (_request, response) => {

  //clear the cookie for the login session in the browser.
  response.setHeader("Set-Cookie", clearAuthCookie());
  return response.status(204).end();
});

router.get("/subjects", requireAdmin, async (request, response) => {
  const user = await AdminUser.findById(request.adminUserId).lean();
  if (!user?.course) {
    return response.status(400).json({ error: "Admin course is required." });
  }

  const subjects = await getSubjectCatalog(request.adminUserId, user.course);
  return response.json(subjects);
});

router.post("/admin/subjects", requireAdmin, async (request, response) => {
  const { name, code } = request.body;
  const adminUser = await AdminUser.findById(request.adminUserId);

  if (!adminUser?.course) {
    return response.status(400).json({ error: "Admin course is required before creating subjects." });
  }

  const subject = await addCustomSubject(adminUser.id, adminUser.course, name, code);

  if (!subject) {
    return response.status(400).json({ error: "A subject name is required." });
  }

  return response.status(201).json(subject);
});

router.post("/admin/sessions", requireAdmin, async (request, response) => {
  // Accept either a catalog subject ID or a new subject name from the admin form.
  const { subjectId, subjectName, subjectCode, course, latitude, longitude } = request.body;
  const adminUser = await AdminUser.findById(request.adminUserId);
  let subject = await Subject.findOne({ adminId: request.adminUserId, course: adminUser.course, id: subjectId }).lean();

  if (!subject && subjectName) {
    subject = await addCustomSubject(adminUser.id, adminUser.course, subjectName, subjectCode);
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
    createdBy: request.adminUserId,
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

router.get("/admin/sessions/:token", requireAdmin, async (request, response) => {
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

router.post("/admin/sessions/:token/end", requireAdmin, async (request, response) => {
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
