import mongoose from "mongoose";

// Admin credentials and course information are stored separately from passwords.
const adminUserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    course: { type: String, required: true, trim: true },
    courseDuration: { type: String, required: true, trim: true },
    role: { type: String, enum: ["admin"], default: "admin" },
    resetToken: { type: String, default: null },
    resetTokenExpiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Each subject belongs to one admin/course pair, preventing cross-admin catalog mixing.
const subjectSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },
    course: { type: String, required: true, trim: true },
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

subjectSchema.index({ adminId: 1, course: 1, name: 1 }, { unique: true });
subjectSchema.index(
  { adminId: 1, course: 1, code: 1 },
  { unique: true, sparse: true },
);

// A session captures the rules and location used to validate student check-ins.
const sessionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    token: { type: String, required: true, unique: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: false,
    },
    subjectId: { type: String, required: true },
    subject: { type: Object, required: true },
    course: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    radius: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "ended", "expired"],
      default: "active",
    },
  },
  { timestamps: true },
);

// Attendance records preserve the validated student details used in reporting/export.
const attendanceRecordSchema = new mongoose.Schema(
  {
    sessionToken: { type: String, required: true },
    studentEmail: { type: String, required: true },
    studentName: { type: String, trim: true },
    studentRollNumber: { type: String, trim: true },
    subject: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy: { type: Number, required: true },
    distance: { type: Number, required: true },
    status: { type: String, enum: ["present", "absent"], default: "present" },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Reuse compiled models because Mongoose throws if a model is registered twice.
export const AdminUser =
  mongoose.models.AdminUser || mongoose.model("AdminUser", adminUserSchema);
export const Subject =
  mongoose.models.Subject || mongoose.model("Subject", subjectSchema);
export const AttendanceSession =
  mongoose.models.AttendanceSession ||
  mongoose.model("AttendanceSession", sessionSchema);
export const AttendanceRecord =
  mongoose.models.AttendanceRecord ||
  mongoose.model("AttendanceRecord", attendanceRecordSchema);
