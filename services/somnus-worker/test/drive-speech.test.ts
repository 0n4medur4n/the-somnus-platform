import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { UUIDv7 } from "@somnus/api-contracts";
import { SomnusError } from "@somnus/errors";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { SpeechConfigSchema } from "../src/modules/drive/speech/speech.config.js";
import { SpeechService } from "../src/modules/drive/speech/speech.service.js";

/**
 * Voice in Drive documents (owner decision 2026-11-02, ADR 0019): dictation
 * passes for AssemblyAI and passages read by Google Cloud Text-to-Speech. The
 * outside services are fakes; what is under test is what we send them and
 * what we refuse.
 */
const ACTOR = UUIDv7();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("speech service", () => {
  const configured = SpeechConfigSchema.parse({
    ASSEMBLYAI_API_KEY: "assembly-key",
    TTS_ENABLED: "true",
  });

  it("asks AssemblyAI for a short token with the key, and hands back the EU stream with it", async () => {
    const http = vi.fn().mockResolvedValue(json({ token: "tok-123" }));
    const session = await new SpeechService(configured, http).dictationSession("es");

    const [tokenUrl, init] = http.mock.calls[0] as [URL, RequestInit];
    expect(tokenUrl.origin + tokenUrl.pathname).toBe("https://streaming.assemblyai.com/v3/token");
    expect(tokenUrl.searchParams.get("expires_in_seconds")).toBe("60");
    expect(tokenUrl.searchParams.get("max_session_duration_seconds")).toBe("1800");
    expect(init.headers).toEqual({ authorization: "assembly-key" });

    const stream = new URL(session.url);
    expect(stream.origin + stream.pathname).toBe("wss://streaming.eu.assemblyai.com/v3/ws");
    expect(Object.fromEntries(stream.searchParams)).toEqual({
      sample_rate: "16000",
      encoding: "pcm_s16le",
      inactivity_timeout: "30",
      speech_model: "universal-streaming-multilingual",
      format_turns: "true",
      token: "tok-123",
    });
    // The key itself never reaches the browser.
    expect(session.url).not.toContain("assembly-key");
    expect(session).toMatchObject({ sampleRate: 16_000, expiresInSeconds: 60 });
  });

  it("uses the larger model only for Catalan, which the standard one lacks", async () => {
    const http = vi.fn().mockResolvedValue(json({ token: "tok" }));
    const stream = new URL((await new SpeechService(configured, http).dictationSession("ca")).url);
    expect(stream.searchParams.get("speech_model")).toBe("universal-3-6-pro");
    expect(stream.searchParams.get("language_codes")).toBe("ca");
  });

  it("refuses to dictate without a key, and reports a refused token by status only", async () => {
    const http = vi.fn();
    await expect(
      new SpeechService(SpeechConfigSchema.parse({}), http).dictationSession("es"),
    ).rejects.toBeInstanceOf(SomnusError);
    expect(http).not.toHaveBeenCalled();

    const refused = vi.fn().mockResolvedValue(json({ error: "bad key" }, 401));
    await expect(new SpeechService(configured, refused).dictationSession("es")).rejects.toThrow(
      "Dictation token refused: 401",
    );
    const empty = vi.fn().mockResolvedValue(json({}));
    await expect(new SpeechService(configured, empty).dictationSession("es")).rejects.toThrow(
      "Dictation token missing.",
    );
  });

  it("reads a passage with the worker's own identity and the language's voice", async () => {
    const http = vi.fn().mockResolvedValue(json({ audioContent: "SUQzBAAA" }));
    const token = vi.fn().mockResolvedValue("ya29.worker");
    const result = await new SpeechService(configured, http, token).readAloud(
      "Hola, equipo.",
      "es",
    );

    expect(result).toEqual({ mime: "audio/mpeg", audio: "SUQzBAAA" });
    const [url, init] = http.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eu-texttospeech.googleapis.com/v1/text:synthesize");
    expect(init.headers).toEqual({
      authorization: "Bearer ya29.worker",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      input: { text: "Hola, equipo." },
      voice: { languageCode: "es-ES", name: "es-ES-Chirp3-HD-Kore" },
      audioConfig: { audioEncoding: "MP3" },
    });
  });

  it("reads Catalan with its own voice, where Google serves it", async () => {
    const http = vi.fn().mockResolvedValue(json({ audioContent: "SUQz" }));
    await new SpeechService(configured, http, async () => "t").readAloud("Bon dia.", "ca");
    const [url, init] = http.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://texttospeech.googleapis.com/v1/text:synthesize");
    expect(JSON.parse(String(init.body)).voice).toEqual({
      languageCode: "ca-ES",
      name: "ca-ES-Standard-B",
    });
  });

  it("does not read aloud until enabled, and never puts the text in an error", async () => {
    const http = vi.fn();
    await expect(
      new SpeechService(SpeechConfigSchema.parse({}), http).readAloud("secreto", "es"),
    ).rejects.toThrow("Reading aloud is not configured.");
    expect(http).not.toHaveBeenCalled();

    const failing = vi.fn().mockResolvedValue(json({ error: { message: "secreto" } }, 400));
    const error = await new SpeechService(configured, failing, async () => "t")
      .readAloud("secreto", "es")
      .catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(SomnusError);
    expect((error as Error).message).toBe("Text-to-Speech refused: 400");
  });
});

describe("speech controller (e2e)", () => {
  let app: NestFastifyApplication;
  const dictation = vi.fn().mockResolvedValue({
    url: "wss://streaming.eu.assemblyai.com/v3/ws?token=t",
    sampleRate: 16_000,
    expiresInSeconds: 60,
  });
  const readAloud = vi.fn().mockResolvedValue({ mime: "audio/mpeg", audio: "SUQz" });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SpeechService)
      .useValue({ dictationSession: dictation, readAloud })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("refuses without an acting user, before asking anything", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/v1/drive/speech/dictation",
      payload: { lang: "es" },
    });
    expect(res.statusCode).toBe(401);
    expect(dictation).not.toHaveBeenCalled();
  });

  it("gives a dictation pass for a known language only", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/internal/v1/drive/speech/dictation",
      headers: { "x-somnus-actor-id": ACTOR },
      payload: { lang: "de" },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: "POST",
      url: "/internal/v1/drive/speech/dictation",
      headers: { "x-somnus-actor-id": ACTOR },
      payload: { lang: "es" },
    });
    expect(ok.statusCode).toBe(200);
    expect(dictation).toHaveBeenCalledWith("es");
  });

  it("reads a passage, and refuses one longer than Google accepts", async () => {
    const long = await app.inject({
      method: "POST",
      url: "/internal/v1/drive/speech/read-aloud",
      headers: { "x-somnus-actor-id": ACTOR },
      payload: { text: "a".repeat(4801), lang: "es" },
    });
    expect(long.statusCode).toBe(400);
    expect(readAloud).not.toHaveBeenCalled();
    const ok = await app.inject({
      method: "POST",
      url: "/internal/v1/drive/speech/read-aloud",
      headers: { "x-somnus-actor-id": ACTOR },
      payload: { text: "Hola", lang: "es" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ mime: "audio/mpeg", audio: "SUQz" });
    expect(readAloud).toHaveBeenCalledWith("Hola", "es");
  });
});
