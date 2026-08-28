export const subjects = [
  { id: 'dbms', name: 'Database Management Systems', code: 'DBMS' },
  { id: 'os', name: 'Operating Systems', code: 'OS' }
];

export function addCustomSubject(name, code = '') {
  const trimmedName = name.trim();
  const trimmedCode = (code || trimmedName).trim();

  if (!trimmedName) {
    return null;
  }

  const existing = subjects.find((subject) => subject.name.toLowerCase() === trimmedName.toLowerCase());
  if (existing) {
    return existing;
  }

  const subject = {
    id: `custom-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: trimmedName,
    code: trimmedCode.toUpperCase().slice(0, 12) || 'CUST',
  };

  subjects.push(subject);
  return subject;
}

export const sessions = new Map();
export const attendance = new Map();
