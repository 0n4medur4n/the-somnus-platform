import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { CurrentLegalDocumentsResponse } from "@somnus/api-contracts";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { ConsentProxyService } from "./consent.service.js";

/**
 * Public, unauthenticated (mirrors identity's LegalDocumentsController):
 * reading current legal documents must work before a session exists.
 * Not CSRF-relevant (GET) and requires no actor.
 */
@ApiTags("consent")
@Controller({ path: "v1/legal-documents" })
export class LegalDocumentsController {
  constructor(private readonly consent: ConsentProxyService) {}

  @Get("current")
  @ApiOperation({ summary: "The current published version of every purpose's legal document." })
  async current(
    @Query("locale") locale?: string,
    @CorrelationId() correlationId?: string,
  ): Promise<CurrentLegalDocumentsResponse> {
    return this.consent.getLegalDocuments(locale, correlationId);
  }
}
