export function backupsToKeep(names: string[], opts?: { days?: number; months?: number }): Set<string>;
export function backupName(d?: Date): string;
export function encodePath(path: string): string;
