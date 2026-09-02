import mongoose from "mongoose";

// Read the database location from the environment while keeping local development zero-config.
export const mongoUri =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/qr-attendance";

export async function connectDb() {
  // Avoid opening a second connection when the app or tests call this more than once.
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  mongoose.set("strictQuery", true);

  // Fail quickly when MongoDB is unavailable so startup reports a useful error.
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: true,
    family: 4,
  });

  console.log("MongoDB connected successfully.");
  return mongoose.connection;
}

export async function disconnectDb() {
  // Tests and graceful shutdown can use this to release the active connection.
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log("MongoDB disconnected");
  }
}
