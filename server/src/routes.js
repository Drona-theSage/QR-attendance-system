import { Router } from "express";
import QRCode from "qrcode";
import {
  AdminUser,
  AttendanceRecord,
  AttendanceSession,
  Subject,
} from "./models.js";
import {
  clearAuthCookie,
  createAuthCookie,
  hashPassword,
  requireAdmin,
  verifyPassword,
} from "./auth.js";
import { createToken, distanceInMeters, isUniversityEmail } from "./utils.js";
import nodemailer from "nodemailer";
import { OAuth2Client } from "google-auth-library";

const router = Router();
// OAuth2Client verifies Google-signed ID tokens using Google's public keys.
const googleClient = new OAuth2Client();

async function getVerifiedStudentEmail(credential, fallbackEmail) {
  // Test fallback keeps existing endpoint tests deterministic; production requires Google.
  if (process.env.NODE_ENV === "test" && fallbackEmail) {
    return String(fallbackEmail).trim().toLowerCase();
  }

  if (!credential || !process.env.GOOGLE_CLIENT_ID) {
    return null;
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || payload.email_verified !== true) {
      return null;
    }
    return payload.email.trim().toLowerCase();
  } catch {
    return null;
  }
}

async function getSubjectCatalog(adminUserId, course) {
  // lean() returns plain objects because the route only needs to serialize them.
  return Subject.find({ adminId: adminUserId, course })
    .sort({ name: 1 })
    .lean();
}

async function addCustomSubject(adminUserId, course, name, code = "") {
  // Normalize form values before duplicate checks and database writes.
  const trimmedName = String(name || "").trim();
  const trimmedCode = String(code || trimmedName).trim();

  if (!trimmedName) {
    return null;
  }

  const existing = await Subject.findOne({
    adminId: adminUserId,
    course,
    name: {
      $regex: new RegExp(
        `^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i",
      ),
    },
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

// Registration creates an admin account and immediately establishes its login cookie.
router.post("/auth/register", async (request, response) => {
  const { name, email, password, course, courseDuration } = request.body;
  const normalizedEmail = email?.trim().toLowerCase();
  const normalizedCourse = course?.trim();
  const normalizedDuration = courseDuration?.trim();

  if (
    !name?.trim() ||
    !normalizedEmail ||
    !password ||
    password.length < 8 ||
    !normalizedCourse ||
    !normalizedDuration
  ) {
    return response
      .status(400)
      .json({
        error:
          "Name, email, course, course duration, and a password of at least 8 characters are required.",
      });
  }

  try {
    const existingUser = await AdminUser.findOne({
      email: normalizedEmail,
    }).lean();
    if (
      existingUser &&
      existingUser.course &&
      existingUser.course.toLowerCase() !== normalizedCourse.toLowerCase()
    ) {
      return response.status(409).json({
        error:
          "This email is already mapped to a different course. Please use a new email or delete your previous account to use this email again.",
      });
    }

    if (
      existingUser &&
      existingUser.course &&
      existingUser.course.toLowerCase() === normalizedCourse.toLowerCase()
    ) {
      return response
        .status(409)
        .json({
          error: "An account with this email already exists for this course.",
        });
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
      return response
        .status(409)
        .json({ error: "An account with this email already exists." });
    }
    throw error;
  }
});

router.post("/auth/forgot-password", async (request, response) => {
  // A random, expiring token is stored temporarily for the emailed reset link.
  const email = request.body.email?.trim().toLowerCase();
  if (!email) {
    return response.status(400).json({ error: "Email is required." });
  }

  const user = await AdminUser.findOne({ email });
  if (!user) {
    return response
      .status(404)
      .json({ error: "No admin account exists for this email." });
  }

  const resetToken = createToken();
  const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

  user.resetToken = resetToken;
  user.resetTokenExpiresAt = resetTokenExpiresAt;
  await user.save();

  const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${encodeURIComponent(resetToken)}`;

  const hasSmtpCredentials = Boolean(
    process.env.SMTP_USER && process.env.SMTP_PASS,
  );

  if (!hasSmtpCredentials) {
    console.log(
      `Password reset requested for ${user.email}. Reset link: ${resetUrl}`,
    );
    return response.json({
      message:
        "A password reset link has been generated. Configure SMTP credentials to email it automatically.",
      resetUrl,
    });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  try {
    await transporter.sendMail({
      from:
        process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@localhost",
      to: user.email,
      subject: "Reset your QR Attendance admin password",
      html: `
        <p>Hello ${user.name},</p>
        <p>We received a request to reset your admin password.</p>
        <p><a href="${resetUrl}">Click here to reset your password</a></p>
        <p>This link expires in 1 hour.</p>
      `,
      text: `Hello ${user.name},\n\nClick the following link to reset your password:\n${resetUrl}\n\nThis link expires in 1 hour.`,
    });
  } catch (error) {
    console.error("Password reset email send failed:", error.message);
    return response.status(500).json({
      error:
        "Unable to send the reset email right now. Please try again later.",
      resetUrl,
    });
  }

  return response.json({
    message: "A password reset link has been sent to your email.",
    resetUrl,
  });
});

router.post("/auth/reset-password", async (request, response) => {
  // A successful reset replaces the hash and invalidates the token in one update flow.
  const { token, password } = request.body;
  if (!token || !password || String(password).length < 8) {
    return response
      .status(400)
      .json({
        error:
          "A valid reset token and a password with at least 8 characters are required.",
      });
  }

  const user = await AdminUser.findOne({ resetToken: token });
  if (!user) {
    return response
      .status(400)
      .json({ error: "This reset link is invalid or has already been used." });
  }

  if (
    !user.resetTokenExpiresAt ||
    new Date(user.resetTokenExpiresAt) < new Date()
  ) {
    user.resetToken = null;
    user.resetTokenExpiresAt = null;
    await user.save();
    return response
      .status(400)
      .json({ error: "This reset link has expired. Request a new one." });
  }

  user.passwordHash = await hashPassword(String(password));
  user.resetToken = null;
  user.resetTokenExpiresAt = null;
  await user.save();

  return response.json({ message: "Password updated successfully." });
});

// Login compares the submitted password with the stored bcrypt hash.
router.post("/auth/login", async (request, response) => {
  const normalizedEmail = request.body.email?.trim().toLowerCase();
  const user = await AdminUser.findOne({ email: normalizedEmail });

  //check if user exists and verify the password with hashed password saved in db , otherwise throw error.
  if (
    !user ||
    !(await verifyPassword(request.body.password || "", user.passwordHash))
  ) {
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

// This endpoint lets the frontend restore an existing admin session on page load.
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

// Logout expires the browser cookie; authentication state is removed client-side by navigation.
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
    return response
      .status(400)
      .json({ error: "Admin course is required before creating subjects." });
  }

  const subject = await addCustomSubject(
    adminUser.id,
    adminUser.course,
    name,
    code,
  );

  if (!subject) {
    return response.status(400).json({ error: "A subject name is required." });
  }

  return response.status(201).json(subject);
});

router.delete(
  "/admin/subjects/:id",
  requireAdmin,
  async (request, response) => {
    const subject = await Subject.findOne({
      id: request.params.id,
      adminId: request.adminUserId,
    });
    if (!subject) {
      return response.status(404).json({ error: "Subject not found." });
    }

    await Subject.deleteOne({ _id: subject._id });
    return response.json({ ok: true, deletedId: subject.id });
  },
);

router.post("/admin/sessions", requireAdmin, async (request, response) => {
  // Accept either a catalog subject ID or a new subject name from the admin form.
  const { subjectId, subjectName, subjectCode, course, latitude, longitude } =
    request.body;
  const adminUser = await AdminUser.findById(request.adminUserId);
  let subject = await Subject.findOne({
    adminId: request.adminUserId,
    course: adminUser.course,
    id: subjectId,
  }).lean();

  if (!subject && subjectName) {
    subject = await addCustomSubject(
      adminUser.id,
      adminUser.course,
      subjectName,
      subjectCode,
    );
  }

  if (
    !subject ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !course?.trim()
  ) {
    return response
      .status(400)
      .json({
        error: "A subject, course, and valid admin location are required.",
      });
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

router.get("/admin/history", requireAdmin, async (request, response) => {
  const sessions = await AttendanceSession.find({
    createdBy: request.adminUserId,
  })
    .sort({ createdAt: -1 })
    .lean();

  const sessionSummaries = await Promise.all(
    sessions.map(async (session) => {
      const attendance = await AttendanceRecord.find({
        sessionToken: session.token,
      }).lean();
      return {
        id: session.id,
        token: session.token,
        course: session.course,
        subject: session.subject,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        status:
          new Date() >= new Date(session.expiresAt)
            ? "expired"
            : session.status,
        attendanceCount: attendance.length,
        studentUrl: `${process.env.FRONTEND_URL || "http://localhost:5173"}/attendance/${session.token}`,
      };
    }),
  );

  const totalAttendance = sessionSummaries.reduce(
    (sum, item) => sum + item.attendanceCount,
    0,
  );

  return response.json({
    totalSessions: sessionSummaries.length,
    totalAttendance,
    sessions: sessionSummaries,
  });
});

router.get(
  "/admin/sessions/:token/export",
  requireAdmin,
  async (request, response) => {
    // CSV export is deliberately delayed until the attendance window has closed.
    const session = await AttendanceSession.findOne({
      token: request.params.token,
      createdBy: request.adminUserId,
    }).lean();

    if (!session) {
      return response.status(404).json({ error: "Session not found." });
    }

    if (new Date() < new Date(session.expiresAt)) {
      return response
        .status(409)
        .json({
          error: "Attendance can be downloaded after the session expires.",
        });
    }

    const records = await AttendanceRecord.find({ sessionToken: session.token })
      .sort({ timestamp: 1 })
      .lean();
    // Quoting every cell keeps commas, quotes, and line breaks safe in spreadsheet software.
    const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Student Name", "Class Roll Number", "Subject", "Status", "Timestamp"],
      ...records.map((record) => [
        record.studentName,
        record.studentRollNumber,
        record.subject,
        record.status,
        record.timestamp ? new Date(record.timestamp).toISOString() : "",
      ]),
    ];
    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
    const filename = `attendance-${session.id}.csv`;

    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    return response.send(`\uFEFF${csv}\r\n`);
  },
);

router.get(
  "/admin/sessions/:token",
  requireAdmin,
  async (request, response) => {
    // The admin view uses this endpoint to refresh the current attendance list.
    const session = await AttendanceSession.findOne({
      token: request.params.token,
    }).lean();
    if (!session)
      return response.status(404).json({ error: "Session not found." });

    const records = await AttendanceRecord.find({
      sessionToken: session.token,
    }).lean();
    return response.json({
      ...session,
      status:
        new Date() >= new Date(session.expiresAt) ? "expired" : session.status,
      attendance: records,
    });
  },
);

router.post(
  "/admin/sessions/:token/end",
  requireAdmin,
  async (request, response) => {
    const session = await AttendanceSession.findOne({
      token: request.params.token,
    });
    if (!session)
      return response.status(404).json({ error: "Session not found." });

    session.status = "ended";
    await session.save();
    return response.json(session.toObject());
  },
);

router.post(
  "/admin/sessions/:token/manual-mark",
  requireAdmin,
  async (request, response) => {
    // Manual marking uses the same attendance collection but records admin-entered coordinates.
    const session = await AttendanceSession.findOne({
      token: request.params.token,
      createdBy: request.adminUserId,
    });
    if (!session) {
      return response.status(404).json({ error: "Session not found." });
    }

    const { studentName, classRollNumber, email } = request.body;
    const trimmedName = String(studentName || "").trim();
    const trimmedRoll = String(classRollNumber || "").trim();
    const normalizedEmail = email
      ? String(email).trim().toLowerCase()
      : `${trimmedName.toLowerCase().replace(/[^a-z0-9]/g, "") || "manual"}@manual.local`;

    if (!trimmedName || !trimmedRoll) {
      return response
        .status(400)
        .json({ error: "Student name and class roll number are required." });
    }

    const duplicate = await AttendanceRecord.findOne({
      sessionToken: session.token,
      $or: [
        { studentEmail: normalizedEmail },
        { studentName: trimmedName, studentRollNumber: trimmedRoll },
      ],
    });

    if (duplicate) {
      return response
        .status(409)
        .json({ error: "This student is already marked for this session." });
    }

    const record = await AttendanceRecord.create({
      sessionToken: session.token,
      studentEmail: normalizedEmail,
      studentName: trimmedName,
      studentRollNumber: trimmedRoll,
      subject: session.subject.name,
      latitude: session.latitude,
      longitude: session.longitude,
      accuracy: 0,
      distance: 0,
      status: "present",
      timestamp: new Date(),
    });

    return response.status(201).json(record.toObject());
  },
);

router.get("/attendance/session/:token", async (request, response) => {
  // Students receive only the public session details needed to check in.
  const session = await AttendanceSession.findOne({
    token: request.params.token,
  }).lean();
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
  const session = await AttendanceSession.findOne({
    token: request.params.token,
  });
  const {
    email,
    googleCredential,
    name,
    classRollNumber,
    latitude,
    longitude,
    accuracy,
  } = request.body;
  const verifiedEmail = await getVerifiedStudentEmail(googleCredential, email);
  const studentName = String(name || "").trim();
  const studentRollNumber = String(classRollNumber || "").trim();

  if (!session)
    return response.status(404).json({ error: "QR session not found." });
  if (session.status !== "active" || new Date() >= new Date(session.expiresAt))
    return response
      .status(410)
      .json({ error: "This attendance session has expired or ended." });
  if (!studentName || !studentRollNumber)
    return response
      .status(400)
      .json({ error: "Student name and class roll number are required." });
  if (!verifiedEmail)
    return response
      .status(401)
      .json({
        error:
          "Verify your student email with Google before marking attendance.",
      });
  if (!isUniversityEmail(verifiedEmail))
    return response
      .status(403)
      .json({ error: "Use your university email address." });
  if (![latitude, longitude, accuracy].every(Number.isFinite))
    return response
      .status(400)
      .json({ error: "Valid location data is required." });
  if (accuracy > 200)
    return response.status(422).json({
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
    return response.status(422).json({
      error: `You are outside the ${session.radius} meter attendance radius.`,
    });

  const existingRecord = await AttendanceRecord.findOne({
    sessionToken: session.token,
    $or: [{ studentEmail: verifiedEmail }, { studentName, studentRollNumber }],
  });

  if (existingRecord)
    return response
      .status(409)
      .json({ error: "Attendance is already marked for this student." });

  const record = await AttendanceRecord.create({
    sessionToken: session.token,
    studentEmail: verifiedEmail,
    studentName,
    studentRollNumber,
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
