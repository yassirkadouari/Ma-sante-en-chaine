const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const prescriptionRoutes = require("./routes/prescriptions");
const adminRoutes = require("./routes/admin");
const claimsRoutes = require("./routes/claims");
const medicalEventsRoutes = require("./routes/medicalEventsSecure");
const { attachRequestContext } = require("./middleware/requestContext");
const { errorHandler, notFound } = require("./middleware/errorHandler");
const { env } = require("./config/env");

function createApp() {
  const app = express();

  const allowedOrigins = env.corsOrigin === "*" ? true : env.corsOrigin.split(",").map((item) => item.trim());

  app.use(helmet());
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: "2mb" }));
  app.use(attachRequestContext);

  app.get("/health", (req, res) => {
    res.json({ status: "ok", requestId: req.requestId });
  });

  app.use("/auth", authRoutes);
  app.use("/prescriptions", prescriptionRoutes);
  app.use("/admin", adminRoutes);
  app.use("/claims", claimsRoutes);
  app.use("/medical-events", medicalEventsRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp
};
