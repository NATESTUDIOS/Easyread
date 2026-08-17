// server.js
// EasyRead Render Server - Manages Scraper and Processor

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// ============================================
// CONFIGURATION
// ============================================

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || "development";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ============================================
// CORS CONFIGURATION
// ============================================

const allowedOrigins = [
  "https://easyread.vercel.app",
  "https://www.easyread.vercel.app",
  "https://easyread.app",
  "https://www.easyread.app",
  BASE_URL,
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [])
];

// ============================================
// EXPRESS APP
// ============================================

const app = express();

// ✅ CORS setup
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin) || NODE_ENV === "development") {
        return callback(null, true);
      }

      console.warn("❌ Blocked CORS request from:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-key", "x-api-key", "x-user-id"],
    credentials: true,
  })
);

// ✅ Handle preflight (OPTIONS) requests explicitly
app.options("*", cors());

// Middleware
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`📥 ${timestamp} ${req.method} ${req.path}`);
  next();
});

// ============================================
// IMPORT ROUTES
// ============================================

// Processor - AI processing routes
import processorRouter from "./api/processor.js";

// Scraper - Scraping routes
import scraperRouter from "./api/scraper.js";

import nytRouter from "./api/nyt.js";

// ============================================
// MOUNT ROUTES
// ============================================

// Mount processor routes at /api/processor
app.use("/api/processor", processorRouter);

// Mount scraper routes at /api/scraper
app.use("/api/scraper", scraperRouter);


app.use("/", nytRouter);

// ============================================
// HEALTH CHECK
// ============================================

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "EasyRead Render",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    baseUrl: BASE_URL,
    endpoints: {
      processor: "/api/processor",
      scraper: "/api/scraper"
    }
  });
});

// ============================================
// ROOT
// ============================================

app.get("/", (req, res) => {
  res.json({
    service: "EasyRead Render Service",
    version: "1.0.0",
    status: "operational",
    endpoints: {
      health: "/health",
      processor: "/api/processor",
      scraper: "/api/scraper"
    },
    timestamp: new Date().toISOString()
  });
});

// ============================================
// 404 HANDLER
// ============================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
    path: req.path,
    method: req.method
  });
});

// ============================================
// ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({
    success: false,
    error: err.message || "Internal server error",
    timestamp: new Date().toISOString()
  });
});

// ============================================
// START SERVER
// ============================================

const server = app.listen(PORT, () => {
  console.log(`
  🚀 EasyRead Render Server Running
  ─────────────────────────────────
  • Mode: ${NODE_ENV}
  • Port: ${PORT}
  • Base URL: ${BASE_URL}
  • Health: ${BASE_URL}/health
  • Processor: ${BASE_URL}/api/processor
  • Scraper: ${BASE_URL}/api/scraper
  • Time: ${new Date().toISOString()}
  `);
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

async function shutdown(signal) {
  console.log(`\n📥 ${signal} received, shutting down gracefully...`);

  // Close server
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.log("⚠️ Force exit after timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ============================================
// EXPORT FOR TESTING
// ============================================

export { app, server };