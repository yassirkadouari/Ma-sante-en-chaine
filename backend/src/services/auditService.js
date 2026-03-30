const AuditLog = require("../models/AuditLog");

async function logAudit({ action, actorWallet, actorRole, targetRecordId, requestId, ip, metadata }) {
  await AuditLog.create({
    action,
    actorWallet,
    actorRole,
    targetRecordId,
    requestId,
    ip,
    metadata: metadata || {}
  });
}

module.exports = {
  logAudit
};
