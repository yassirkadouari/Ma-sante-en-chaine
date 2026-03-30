const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

dotenv.config();

const { connectDatabase } = require("./mongo");
const authRoutes = require("./routes/auth");
const prescriptionRoutes = require("./routes/prescriptions");
const adminRoutes = require("./routes/admin");
const { attachRequestContext } = require("./middleware/requestContext");
const { errorHandler, notFound } = require("./middleware/errorHandler");
const { env } = require("./config/env");

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

app.use(notFound);
app.use(errorHandler);

const port = env.port;

connectDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`API running on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Mongo connection failed:", err);
    process.exit(1);
  });
