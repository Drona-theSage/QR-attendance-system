// Legacy in-memory examples kept for learning; the running API uses MongoDB models.
export const subjects = [
  { id: "dbms", name: "Database Management Systems", code: "DBMS" },
  { id: "os", name: "Operating Systems", code: "OS" },
];

export function addCustomSubject(name, code = "") {
  // trim() removes accidental spaces before comparing or storing user input.
  const trimmedName = name.trim();
  const trimmedCode = (code || trimmedName).trim();

  if (!trimmedName) {
    return null;
  }

  // find() returns the first matching item, or undefined when no item exists.
  const existing = subjects.find(
    (subject) => subject.name.toLowerCase() === trimmedName.toLowerCase(),
  );
  if (existing) {
    return existing;
  }

  const subject = {
    id: `custom-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: trimmedName,
    code: trimmedCode.toUpperCase().slice(0, 12) || "CUST",
  };

  subjects.push(subject);
  return subject;
}

// Map stores key/value pairs in memory; these exports are not used for production persistence.
export const sessions = new Map();
export const attendance = new Map();
