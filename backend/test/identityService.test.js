const test = require("node:test");
const assert = require("node:assert/strict");

const { canAccessRole, isUserProfileComplete } = require("../src/services/identityService");

test("denies medecin when doctor approval is pending", () => {
  const result = canAccessRole(
    {
      role: "MEDECIN",
      doctorApprovalStatus: "PENDING"
    },
    "MEDECIN"
  );

  assert.equal(result.allowed, false);
  assert.match(result.reason, /validation/i);
});

test("allows approved medecin", () => {
  const result = canAccessRole(
    {
      role: "MEDECIN",
      doctorApprovalStatus: "APPROVED"
    },
    "MEDECIN"
  );

  assert.equal(result.allowed, true);
});

test("denies assurance without institution/department", () => {
  const result = canAccessRole(
    {
      role: "ASSURANCE",
      institutionName: null,
      departmentName: null
    },
    "ASSURANCE"
  );

  assert.equal(result.allowed, false);
  assert.match(result.reason, /institut|departement/i);
});

test("allows assurance with institution/department", () => {
  const result = canAccessRole(
    {
      role: "ASSURANCE",
      institutionName: "CNSS",
      departmentName: "Remboursements"
    },
    "ASSURANCE"
  );

  assert.equal(result.allowed, true);
});

test("reports incomplete profile for admin bootstrap placeholder", () => {
  const complete = isUserProfileComplete({
    fullName: "PENDING_PROFILE",
    nickname: "PENDING_PROFILE",
    dateOfBirth: "1900-01-01"
  });

  assert.equal(complete, false);
});

test("reports complete profile when user data is properly filled", () => {
  const complete = isUserProfileComplete({
    fullName: "Jane Doe",
    nickname: "jane",
    dateOfBirth: "1998-02-10"
  });

  assert.equal(complete, true);
});
