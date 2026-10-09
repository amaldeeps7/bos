export interface AuthUser {
  id: string; name: string; email: string; title: string;
  roleId: string; roleName: string; builtIn: boolean;
  perms: string[]; modules: Record<string, boolean>;
}
