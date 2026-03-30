const ROLES = {
  ADMIN: "ADMIN",
  PATIENT: "PATIENT",
  MEDECIN: "MEDECIN",
  PHARMACIE: "PHARMACIE",
  HOPITAL: "HOPITAL",
  LABO: "LABO",
  ASSURANCE: "ASSURANCE"
};

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase();
}

module.exports = {
  ROLES,
  normalizeRole
};
