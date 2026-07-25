import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type CurrentLegalDocumentsResponse,
  DEFAULT_LOCALE,
  isSupportedLocale,
} from "@somnus/api-contracts";
import { ConsentService } from "./consent.service.js";

/**
 * Public, unauthenticated on purpose: reading current Terms of Service
 * / Privacy Policy content cannot require an account (real-world
 * signup flows need to show this before authentication exists). No
 * `@CurrentActorId()` here -- this is the one consent endpoint with no
 * per-user data.
 */
@ApiTags("consent")
@Controller({ path: "v1/legal-documents" })
export class LegalDocumentsController {
  constructor(private readonly consentService: ConsentService) {}

  @Get("current")
  @ApiOperation({ summary: "The current published version of every purpose's legal document." })
  async current(@Query("locale") locale?: string): Promise<CurrentLegalDocumentsResponse> {
    const resolvedLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
    return this.consentService.getCurrentLegalDocuments(resolvedLocale);
  }
}
