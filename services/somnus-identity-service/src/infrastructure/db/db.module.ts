import { Global, Module } from "@nestjs/common";
import { createDb, createPool, type Db } from "./db.client.js";
import { loadDbConfig } from "./db.config.js";
import {
  AccessGrantsRepository,
  AuditRepository,
  IndividualProfilesRepository,
  OrganizationInvitationsRepository,
  OrganizationMembershipsRepository,
  OrganizationsRepository,
  ProfessionalProfilesRepository,
  RoleAssignmentsRepository,
  RolesRepository,
  UsersRepository,
} from "./repositories/index.js";

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
      provide: DB,
      useFactory: (): Db => {
        const config = loadDbConfig(process.env);
        const pool = createPool(config);
        return createDb(pool);
      },
    },
    { provide: UsersRepository, useFactory: (db: Db) => new UsersRepository(db), inject: [DB] },
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
    IndividualProfilesRepository,
    ProfessionalProfilesRepository,
    OrganizationsRepository,
    OrganizationMembershipsRepository,
    OrganizationInvitationsRepository,
    RolesRepository,
    RoleAssignmentsRepository,
    AccessGrantsRepository,
    AuditRepository,
  ],
})
export class DbModule {}
