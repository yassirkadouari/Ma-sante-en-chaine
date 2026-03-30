function notFound(req, res) {
  res.status(404).json({ error: "Not found" });
}

function errorHandler(error, req, res, next) {
  console.error(error);
  if (res.headersSent) {
    return next(error);
  }

  const status = Number(error.status || 500);
  res.status(status).json({
    error: error.publicMessage || "Internal server error",
    requestId: req.requestId || null
  });
}

module.exports = {
  notFound,
  errorHandler
};
