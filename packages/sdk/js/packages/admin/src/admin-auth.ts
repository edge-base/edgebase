/**
 * Admin Auth client for server-side user management
 *: admin.auth context — Service Key required
 *: Service Key
 */

import type { HttpClient } from '@edgebase/core';
import { EdgeBaseError, HttpClientAdapter } from '@edgebase/core';
import { DefaultAdminApi } from './generated/admin-api-core.js';

export interface UserRecord {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  role?: string;
  emailVisibility?: string;
  isAnonymous?: boolean;
  customClaims?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ListUsersResult {
  users: UserRecord[];
  cursor?: string;
}

export interface CreateUserOptions {
  email: string;
  password: string;
  displayName?: string;
  role?: string;
  /** Preferred locale for this user (e.g. 'ko', 'ja'). Default: 'en' */
  locale?: string;
}

export interface UpdateUserOptions {
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  role?: string;
  emailVisibility?: string;
  /** Preferred locale for this user (e.g. 'ko', 'ja'). */
  locale?: string;
}

export class AdminAuthClient {
  private hasServiceKey: boolean;
  private adminCore: DefaultAdminApi;

  constructor(
    private client: HttpClient,
    hasServiceKey: boolean,
  ) {
    this.hasServiceKey = hasServiceKey;
    this.adminCore = new DefaultAdminApi(new HttpClientAdapter(client));
  }

  /** Ensure Service Key is configured */
  private requireServiceKey(): void {
    if (!this.hasServiceKey) {
      throw new EdgeBaseError(
        403,
        'admin.auth requires serviceKey. Initialize EdgeBase with { serviceKey: "..." } option.',
      );
    }
  }

  /** Get a user by ID */
  async getUser(userId: string): Promise<UserRecord> {
    this.requireServiceKey();
    const result = await this.adminCore.adminAuthGetUser(userId) as { user: UserRecord };
    return (result as any).user ?? result;
  }

  /** List users with pagination */
  async listUsers(options?: {
    limit?: number;
    cursor?: string;
  }): Promise<ListUsersResult> {
    this.requireServiceKey();
    const query: Record<string, string> = {};
    if (options?.limit) query.limit = String(options.limit);
    if (options?.cursor) query.cursor = options.cursor;
    return this.adminCore.adminAuthListUsers(query) as Promise<ListUsersResult>;
  }

  /** Create a new user (server-side registration) */
  async createUser(data: CreateUserOptions): Promise<UserRecord> {
    this.requireServiceKey();
    const result = await this.adminCore.adminAuthCreateUser(data) as { user: UserRecord };
    return (result as any).user ?? result;
  }

  /** Update a user */
  async updateUser(userId: string, data: UpdateUserOptions): Promise<UserRecord> {
    this.requireServiceKey();
    const result = await this.adminCore.adminAuthUpdateUser(userId, data) as { user: UserRecord };
    return (result as any).user ?? result;
  }

  /** Delete a user */
  async deleteUser(userId: string): Promise<void> {
    this.requireServiceKey();
    await this.adminCore.adminAuthDeleteUser(userId);
  }

  /** Set custom claims for a user (reflected in JWT on next token refresh) */
  async setCustomClaims(
    userId: string,
    claims: Record<string, unknown>,
  ): Promise<void> {
    this.requireServiceKey();
    await this.adminCore.adminAuthSetClaims(userId, claims);
  }

  /** Revoke all sessions for a user (force re-authentication) */
  async revokeAllSessions(userId: string): Promise<void> {
    this.requireServiceKey();
    await this.adminCore.adminAuthRevokeUserSessions(userId);
  }
}
