/**
 * @file src/app.d.ts
 * @description This file defines the types for the app.
 */

import type { Role, Token, User } from "@src/databases/auth/types";
import type { DatabaseAdapter, Theme } from "@src/databases/db-interface";

declare global {
  namespace App {
    interface Locals {
      // Setup hook caching
      __setupConfigExists?: boolean;
      __setupLogged?: boolean;
      __setupLoginRedirectLogged?: boolean;
      __setupRedirectLogged?: boolean;
      allTokens: Token[];
      allUsers: User[];
      collections?: unknown;

      // High-performance Local API (Payload style)
      cms?: {
        find: (
          collection: string,
          options?: any,
        ) => Promise<import("@src/databases/db-interface").DatabaseResult<any[]>>;
        findById: (
          collection: string,
          id: string,
          options?: any,
        ) => Promise<import("@src/databases/db-interface").DatabaseResult<any | null>>;
        create: (
          collection: string,
          data: any,
          options?: any,
        ) => Promise<import("@src/databases/db-interface").DatabaseResult<any>>;
        update: (
          collection: string,
          id: string,
          data: any,
          options?: any,
        ) => Promise<import("@src/databases/db-interface").DatabaseResult<any>>;
        delete: (
          collection: string,
          id: string,
          options?: any,
        ) => Promise<import("@src/databases/db-interface").DatabaseResult<void>>;
        context: {
          isLocal: boolean;
          tenantId: string | null | undefined;
          user: User | null;
        };
        db: import("@src/databases/db-interface").IDBAdapter;
      };

      cspNonce?: string;
      customCss: string;
      darkMode: boolean;
      dbAdapter?: DatabaseAdapter | null;
      degradedServices?: string[];
      getSession: () => Promise<import("@auth/core/types").Session | null>;
      hasManageUsersPermission: boolean;
      hasAdminPermission: boolean;
      isAdmin: boolean;
      isFirstUser: boolean;
      language: string;
      permissions: string[];
      roles: Role[];
      session_id?: string;
      tenantId?: string | null;
      theme: Theme | null;
      user: User | null;
    }
  }

  // Common interfaces
  interface Result {
    data: unknown;
    errors: string[];
    message: string;
    success: boolean;
  }
}
