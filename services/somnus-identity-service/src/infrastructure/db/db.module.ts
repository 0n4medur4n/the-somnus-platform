import { Global, Module } from "@nestjs/common";
import { createDb, createPool, type Db } from "./db.client.js";
import { loadDbConfig } from "./db.config.js";
import {
  AccessGrantsRepository,
  AccountDeletionRepository,
  AuditRepository,
  IndividualProfilesRepository,
  OrganizationInvitationsRepository,
  OrganizationMembershipsRepository,
  OrganizationsRepository,
  PlatformInvitationsRepository,
  ProfessionalProfilesRepository,
  RoleAssignmentsRepository,
  RolesRepository,
  StaffInvitationsRepository,
  UsersRepository,
} from "./repositories/index.js";
import { PasskeyChallengesRepository } from "./repositories/passkey-challenges.repository.js";
import { PasskeyCredentialsRepository } from "./repositories/passkey-credentials.repository.js";
import { PasskeyUserHandlesRepository } from "./repositories/passkey-user-handles.repository.js";

export const DB = Symbol("DB");

/**
 * Factory providers, not `@Injectable()` on the repository classes
 * themselves: the repository layer (build plan §20 Checkpoint 6.1)
 * stays framework-agnostic, importable and testable with zero NestJS
 * dependency, exactly as it already is in test/integration/*.
 */
@Global()
@Module({
  providers: [
    {
      provide: PlatformInvitationsRepository,
      useFactory: (db: Db) => new PlatformInvitationsRepository(db),
      inject: [DB],
    },
    {
      provide: DB,
      useFactory: (): Db => {
        const config = loadDbConfig(process.env);
        const pool = createPool(config);
        return createDb(pool);
      },
    },
    { provide: UsersRepository, useFactory: (db: Db) => new UsersRepository(db), inject: [DB] },
    {
      provide: PasskeyCredentialsRepository,
      useFactory: (db: Db) => new PasskeyCredentialsRepository(db),
      inject: [DB],
    },
    {
      provide: PasskeyChallengesRepository,
      useFactory: (db: Db) => new PasskeyChallengesRepository(db),
      inject: [DB],
    },
    {
      provide: PasskeyUserHandlesRepository,
      useFactory: (db: Db) => new PasskeyUserHandlesRepository(db),
      inject: [DB],
    },
    {
      provide: AccountDeletionRepository,
      useFactory: (db: Db) => new AccountDeletionRepository(db),
      inject: [DB],
    },
    {
      provide: IndividualProfilesRepository,
      useFactory: (db: Db) => new IndividualProfilesRepository(db),
      inject: [DB],
    },
    {
      provide: ProfessionalProfilesRepository,
      useFactory: (db: Db) => new ProfessionalProfilesRepository(db),
      inject: [DB],
    },
    {
      provide: OrganizationsRepository,
      useFactory: (db: Db) => new OrganizationsRepository(db),
      inject: [DB],
    },
    {
      provide: OrganizationMembershipsRepository,
      useFactory: (db: Db) => new OrganizationMembershipsRepository(db),
      inject: [DB],
    },
    {
      provide: OrganizationInvitationsRepository,
      useFactory: (db: Db) => new OrganizationInvitationsRepository(db),
      inject: [DB],
    },
    { provide: RolesRepository, useFactory: (db: Db) => new RolesRepository(db), inject: [DB] },
    {
      provide: StaffInvitationsRepository,
      useFactory: (db: Db) => new StaffInvitationsRepository(db),
      inject: [DB],
    },
    {
      provide: RoleAssignmentsRepository,
      useFactory: (db: Db) => new RoleAssignmentsRepository(db),
      inject: [DB],
    },
    {
      provide: AccessGrantsRepository,
      useFactory: (db: Db) => new AccessGrantsRepository(db),
      inject: [DB],
    },
    { provide: AuditRepository, useFactory: (db: Db) => new AuditRepository(db), inject: [DB] },
  ],
  exports: [
    DB,
    UsersRepository,
    PasskeyCredentialsRepository,
    PasskeyChallengesRepository,
    PasskeyUserHandlesRepository,
    AccountDeletionRepository,
    IndividualProfilesRepository,
    ProfessionalProfilesRepository,
    OrganizationsRepository,
    OrganizationMembershipsRepository,
    OrganizationInvitationsRepository,
    RolesRepository,
    PlatformInvitationsRepository,
    StaffInvitationsRepository,
    RoleAssignmentsRepository,
    AccessGrantsRepository,
    AuditRepository,
  ],
})
export class DbModule {}
