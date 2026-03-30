const dotenv = require("dotenv");

dotenv.config();

const { connectDatabase } = require("./mongo");
const { createApp } = require("./app");
const { env } = require("./config/env");

const app = createApp();

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
