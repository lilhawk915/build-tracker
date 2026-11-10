import type { Material, MaterialRequest, Profile, SubJob, TableName, Tables } from '../domain/types';

export interface Store {
  mode: 'local' | 'supabase';
  me(): Promise<Profile | null>;
  onAuthChange(cb: () => void): void;
  signIn(email: string): Promise<string>;
  signOut(): Promise<void>;
  list<T extends TableName>(table: T): Promise<Tables[T][]>;
  insert<T extends TableName>(table: T, rows: Partial<Tables[T]> | Partial<Tables[T]>[]): Promise<void>;
  update<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>): Promise<void>;
  remove<T extends TableName>(table: T, id: string): Promise<void>;
  myJobs(): Promise<SubJob[]>;
  respondPo(id: string, accept: boolean): Promise<void>;
  submitWaiver(id: string, path: string): Promise<void>;
  setTaskStatus(id: string, status: string): Promise<void>;
  upload(path: string, file: File): Promise<string>;
  fileUrl(path: string): Promise<string>;
  removeFile(path: string): Promise<void>;
  crewMaterials(): Promise<Material[]>;
  markMaterialArrived(id: string): Promise<void>;
  confirmTask(id: string): Promise<void>;
  inviteUser(email: string): Promise<void>;
  myMaterialRequests(): Promise<MaterialRequest[]>;
  requestMaterial(job: string, name: string, quantity: string, neededBy: string | null, notes: string): Promise<void>;
  demoSwitch?(who: string): void;
  demoReset?(): void;
}

export const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
