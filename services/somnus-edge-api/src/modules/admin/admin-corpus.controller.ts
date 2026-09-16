import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type CorpusDocument,
  type CorpusDocumentDetail,
  CorpusDocumentDetailSchema,
  type CorpusDocumentPage,
  CorpusDocumentPageSchema,
  CorpusDocumentSchema,
  type CorpusVersionResult,
  CorpusVersionResultSchema,
  type SrcEnrichmentPage,
  SrcEnrichmentPageSchema,
} from "@somnus/api-contracts";
import { correlationOf } from "../../common/composition.util.js";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import {
  CorpusDocumentCreateDto,
  CorpusDocumentEditDto,
  CorpusPublishDto,
  CorpusRetireDto,
  CorpusSearchDto,
} from "./admin.dto.js";
import { AdminAuditInterceptor } from "./admin-audit.interceptor.js";
import { AdminCapabilityGuard } from "./admin-capability.guard.js";
import { AdminCorpusService } from "./admin-corpus.service.js";
import { AdminRoute } from "./admin-route.decorator.js";

/**
 * Reference-corpus management (Addendum B §B3 / §B3.1, Checkpoint 16.3).
 *
 * Every route requires `admin_corpus_manage`, which §B6 item 4 grants to
 * `platform_super_admin` and to nobody else -- not `platform_admin`, and not
 * `clinical_governance_reviewer`, who reviews AI wording rather than deciding
 * what the platform's reference corpus contains. That mapping lives in identity
 * (`admin-capability-policy.ts`); this controller only names the capability.
 *
 * **There is no delete route, and adding one would be a §B3 violation.** Retire
 * is the only terminal action there is: a corpus a console could destroy would
 * leave every older report's `corpus_version` unexplainable. The report service
 * has no delete either, so this is not a UI omission.
 *
 * Reads are audited alongside writes. Who looked at the corpus, and who looked
 * at which clinical source's enrichments, is part of what an audit of a
 * reference corpus has to be able to answer.
 */
@ApiTags("admin")
@Controller({ path: "admin/v1" })
@UseGuards(SessionGuard, AdminCapabilityGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminCorpusController {
  constructor(private readonly corpus: AdminCorpusService) {}

  private actor(session: SessionRecord | undefined): string {
    // The guard resolved and approved the actor before this handler ran.
    return session?.somnusUserId ?? "";
  }

  @Post("corpus/documents/search")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_corpus_manage",
    eventType: "admin.corpus_document.listed.v1",
    entity: "corpus_document",
  })
  @ApiOperation({ summary: "List and search reference documents, retired ones included." })
  async search(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: CorpusSearchDto,
    @CorrelationId() correlationId?: string,
  ): Promise<CorpusDocumentPage> {
    return this.corpus.forward({
      method: "POST",
      path: "/internal/v1/admin/corpus/documents/search",
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: CorpusDocumentPageSchema,
      body,
    });
  }

  @Get("corpus/documents/:documentId")
  @AdminRoute({
    capability: "admin_corpus_manage",
    eventType: "admin.corpus_document.viewed.v1",
    entity: "corpus_document",
  })
  @ApiOperation({ summary: "One reference document, with the text it currently holds." })
  async detail(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("documentId") documentId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<CorpusDocumentDetail> {
    return this.corpus.forward({
      method: "GET",
      path: `/internal/v1/admin/corpus/documents/${encodeURIComponent(documentId)}`,
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: CorpusDocumentDetailSchema,
    });
  }

  @Post("corpus/documents")
  @AdminRoute({
    capability: "admin_corpus_manage",
    eventType: "admin.corpus_document.created.v1",
    entity: "corpus_document",
  })
  @ApiOperation({ summary: "Create a draft. A draft is part of no corpus version yet." })
  async create(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: CorpusDocumentCreateDto,
    @CorrelationId() correlationId?: string,
  ): Promise<CorpusDocument> {
    return this.corpus.forward({
      method: "POST",
      path: "/internal/v1/admin/corpus/documents",
      // Authorship is the session's, never the client's: the corpus history is a
      // record of who decided what belongs in it.
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: CorpusDocumentSchema,
      body,
    });
  }

  @Post("corpus/documents/:documentId/edit")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_corpus_manage",
    eventType: "admin.corpus_document.edited.v1",
    entity: "corpus_document",
  })
  @ApiOperation({
    summary: "Edit a draft. A published document is retired and replaced, never rewritten.",
  })
  async edit(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("documentId") documentId: string,
    @Body() body: CorpusDocumentEditDto,
    @CorrelationId() correlationId?: string,
  ): Promise<CorpusDocument> {
    return this.corpus.forward({
      method: "POST",
      path: `/internal/v1/admin/corpus/documents/${encodeURIComponent(documentId)}/edit`,
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: CorpusDocumentSchema,
      body,
    });
  }

  @Post("corpus/documents/:documentId/publish")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_corpus_manage",
    eventType: "admin.corpus_document.published.v1",
    entity: "corpus_document",
  })
  @ApiOperation({
    summary: "Publish a draft through §B4's rights gate, bumping the corpus version.",
  })
  async publish(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("documentId") documentId: string,
    @Body() body: CorpusPublishDto,
    @CorrelationId() correlationId?: string,
  ): Promise<CorpusVersionResult> {
    return this.corpus.forward({
      method: "POST",
      path: `/internal/v1/admin/corpus/documents/${encodeURIComponent(documentId)}/publish`,
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: CorpusVersionResultSchema,
      body,
    });
  }

  @Post("corpus/documents/:documentId/retire")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_corpus_manage",
    eventType: "admin.corpus_document.retired.v1",
    entity: "corpus_document",
  })
  @ApiOperation({ summary: "Retire a published document. The only terminal action (§B3)." })
  async retire(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("documentId") documentId: string,
    @Body() body: CorpusRetireDto,
    @CorrelationId() correlationId?: string,
  ): Promise<CorpusVersionResult> {
    return this.corpus.forward({
      method: "POST",
      path: `/internal/v1/admin/corpus/documents/${encodeURIComponent(documentId)}/retire`,
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: CorpusVersionResultSchema,
      body,
    });
  }

  @Get("corpus/sources")
  @AdminRoute({
    capability: "admin_corpus_manage",
    eventType: "admin.corpus_sources.viewed.v1",
    entity: "corpus_source",
  })
  @ApiOperation({
    summary: "The fifteen clinical sources, artifact fields read-only, with enrichments.",
  })
  async sources(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<SrcEnrichmentPage> {
    return this.corpus.forward({
      method: "GET",
      path: "/internal/v1/admin/corpus/sources",
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: SrcEnrichmentPageSchema,
    });
  }
}
