import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  DriveDictationRequestSchema,
  type DriveDictationSession,
  DriveReadAloudRequestSchema,
  type DriveReadAloudResult,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";
import { InternalAuthGuard } from "../../../common/guards/internal-auth.guard.js";
import { DriveActor } from "../drive-actor.js";
import { SpeechService } from "./speech.service.js";

class DriveDictationDto extends createZodDto(DriveDictationRequestSchema) {}
class DriveReadAloudDto extends createZodDto(DriveReadAloudRequestSchema) {}

/**
 * Voice for Drive documents (owner decision 2026-11-02, ADR 0019). Edge-api is
 * the only caller, after identity granted `admin_drive`. Unlike the rest of the
 * Drive, a passage to read aloud is plain text: it is never logged or stored.
 */
@ApiTags("drive")
@Controller({ path: "internal/v1/drive/speech" })
@UseGuards(InternalAuthGuard)
export class SpeechController {
  constructor(private readonly speech: SpeechService) {}

  @Post("dictation")
  @HttpCode(200)
  @ApiOperation({ summary: "A one-minute pass for the browser to stream dictation to AssemblyAI." })
  dictation(
    @DriveActor() _actor: string,
    @Body() body: DriveDictationDto,
  ): Promise<DriveDictationSession> {
    return this.speech.dictationSession(body.lang);
  }

  /**
   * The same pass, for a Morpheo free-text answer (ADR 0026). Edge-api is the
   * only caller, and only after it has checked that the interview is open on a
   * free-text step. No Drive actor: an interview may be anonymous, and this
   * route stores nothing — the audio never arrives here.
   */
  @Post("interview-dictation")
  @HttpCode(200)
  @ApiOperation({
    summary: "A one-minute AssemblyAI pass for dictating a Morpheo free-text answer.",
  })
  interviewDictation(@Body() body: DriveDictationDto): Promise<DriveDictationSession> {
    return this.speech.dictationSession(body.lang);
  }

  @Post("read-aloud")
  @HttpCode(200)
  @ApiOperation({ summary: "A passage spoken by Google Cloud Text-to-Speech, as MP3." })
  readAloud(
    @DriveActor() _actor: string,
    @Body() body: DriveReadAloudDto,
  ): Promise<DriveReadAloudResult> {
    return this.speech.readAloud(body.text, body.lang);
  }
}
