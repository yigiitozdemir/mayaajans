export interface Env {
  DB: D1Database;
  HUB: DurableObjectNamespace;
}

export interface UserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  photo: string | null;
  color: string;
  role: 'admin' | 'member';
  can_edit_clients: number;
  status: 'pending' | 'active' | 'removed';
  password_hash: string | null;
  password_salt: string | null;
  settings: string;
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  photo: string | null;
  color: string;
  role: 'admin' | 'member';
  canEditClients: boolean;
  settings: Record<string, unknown>;
  sessionId: string;
}

export type Vars = { user: SessionUser };
