import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Organization } from "@somnus/api-contracts";
import { CurrentActorId } from "../../common/decorators/current-actor.decorator.js";
// biome-ignore lint/style/useImportType: used as @Body() parameter types -- nestjs-zod's global ZodValidationPipe needs a real import to recognize and validate these DTO classes at runtime.
import { OrganizationCreateDto, OrganizationUpdateDto } from "../../common/dto/identity.dto.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve this as a DI token; a type-only import erases the reference and breaks injection.
import { OrganizationsService } from "./organizations.service.js";

@ApiTags("organizations")
@Controller({ path: "v1/organizations" })
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: "Create an organization. The creator becomes its owner." })
  async create(
    @CurrentActorId() actorId: string,
    @Body() body: OrganizationCreateDto,
  ): Promise<Organization> {
    return this.organizationsService.create(actorId, body);
  }

  @Get(":organizationId")
  @ApiOperation({ summary: "Read an organization by id." })
  async getById(@Param("organizationId") organizationId: string): Promise<Organization> {
    return this.organizationsService.getById(organizationId);
  }

  @Patch(":organizationId")
  @ApiOperation({
    summary: "Update an organization. Requires an active admin/owner membership (build plan §11).",
  })
  async update(
    @CurrentActorId() actorId: string,
    @Param("organizationId") organizationId: string,
    @Body() body: OrganizationUpdateDto,
  ): Promise<Organization> {
    // See me.service.ts's patchProfile for why the optional fields are
    // re-spread rather than passed through as-is (exactOptionalPropertyTypes).
    return this.organizationsService.update(actorId, organizationId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    });
  }
}
