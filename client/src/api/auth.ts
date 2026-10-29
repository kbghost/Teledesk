import { api, del, get, patch, post } from './http';
import type { AuthResponse, Me, Ok, Session } from '../types/api';

export const authApi = {
  register: (b: { agencyName: string; displayName: string; email: string; password: string; acceptTerms: true }) => api<AuthResponse>('POST', '/auth/register', { body: b, noAuth: true }),
  login: (b: { email: string; password: string; totp?: string }) => api<AuthResponse>('POST', '/auth/login', { body: b, noAuth: true }),
  logout: () => api<Ok>('POST', '/auth/logout', { noAuth: true }),
  verifyEmail: (token: string) => post<Ok>('/auth/verify-email', { token }),
  forgot: (email: string) => post<Ok>('/auth/forgot-password', { email }),
  reset: (token: string, password: string) => post<Ok>('/auth/reset-password', { token, password }),
  invite: (token: string) => api<{ email: string; displayName: string; role: string; roleLabel: string; agencyName: string }>('GET', `/auth/invite/${token}`, { noAuth: true }),
  acceptInvite: (b: { token: string; password: string; displayName?: string }) => api<AuthResponse>('POST', '/auth/accept-invite', { body: b, noAuth: true }),
  me: () => get<{ user: Me }>('/auth/me'),
  updateMe: (displayName: string) => patch<{ user: Me }>('/auth/me', { displayName }),
  changePassword: (b: { currentPassword: string; newPassword: string }) => post<Ok>('/auth/change-password', b),
  sessions: () => get<Session[]>('/auth/sessions'),
  revokeSession: (id: string) => del<Ok>(`/auth/sessions/${id}`),
  totpSetup: () => post<{ secret: string; otpauthUrl: string }>('/auth/totp/setup'),
  totpEnable: (code: string) => post<{ recoveryCodes: string[] }>('/auth/totp/enable', { code }),
  totpDisable: (password: string) => post<Ok>('/auth/totp/disable', { password }),
};
