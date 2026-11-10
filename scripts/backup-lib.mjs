// Pure helpers for the backup, kept separate so they can be tested.

// Backup folders are named like 2026-11-09T0130. Keeps the newest backup of each of the last
// `days` days, and the newest of each of the last `months` months. Everything else can go.
export function backupsToKeep(names, { days = 30, months = 12 } = {}) {
  const valid = names.filter((n) => /^\d{4}-\d{2}-\d{2}T\d{4}$/.test(n)).sort().reverse();
  const keep = new Set();
  const seenDays = [];
  const seenMonths = [];
  for (const n of valid) {
    const day = n.slice(0, 10);
    const month = n.slice(0, 7);
    if (!seenDays.includes(day) && seenDays.length < days) { seenDays.push(day); keep.add(n); }
    if (!seenMonths.includes(month) && seenMonths.length < months) { seenMonths.push(month); keep.add(n); }
  }
  return keep;
}

export const backupName = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}`;
};

// Each part of a storage path is encoded on its own, so names with spaces or brackets work.
export const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');
