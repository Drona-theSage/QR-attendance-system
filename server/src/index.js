// Loads values from server/.env into process.env before the application reads them.
import "dotenv/config";
// Express creates the HTTP application and router pipeline.
import express from "express";
// CORS controls which browser origin may call this API.
import cors from "cors";
// Helmet adds common security-related HTTP response headers.
import helmet from "helmet";
// The route module contains the application's feature endpoints.
import apiRouter from "./routes.js";
// Database startup is kept separate from HTTP startup for testability.
import { connectDb } from "./db.js";

// The app is exported so the test suite can attach it to an ephemeral port.
const app = express();
// Render provides PORT in production; 4000 is the local default.
const port = Number(process.env.PORT || 4000);

// Register middleware before routes so every request receives these behaviors.
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "qr-attendance-api" });
});

app.use("/api", apiRouter);

app.use((_request, response) => {
  response.status(404).json({ error: "Route not found" });
});

// Tests import the app without opening a long-running listener or database connection.
if (process.env.NODE_ENV !== "test") {
  // async allows the database connection to finish before HTTP traffic is accepted.
  const startServer = async () => {
    try {
      await connectDb();
      const server = app.listen(port, () => {
        console.log(`QR attendance API listening on http://localhost:${port}`);
      });

      server.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
          console.error(
            `Port ${port} is already in use. Stop the existing server or choose another PORT in server/.env.`,
          );
        } else {
          console.error(
            "Unable to start the QR attendance API:",
            error.message,
          );
        }
        process.exitCode = 1;
      });
    } catch (error) {
      console.error("Unable to connect to MongoDB:", error.message);
      process.exitCode = 1;
    }
  };
  // Start the production/development process immediately when this file is executed.
  startServer();
}

export { app };
