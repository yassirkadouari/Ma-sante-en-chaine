const crypto = require("crypto");

function canonicalize(value) {
  if (value === null || value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();

    const entries = keys.map((key) => {
      return `${JSON.stringify(key)}:${canonicalize(value[key])}`;
    });

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function hashEventPayload(payload) {
  const canonical = canonicalize(payload);
  return sha256Hex(canonical);
}

module.exports = {
  canonicalize,
  hashEventPayload,
  sha256Hex
};
