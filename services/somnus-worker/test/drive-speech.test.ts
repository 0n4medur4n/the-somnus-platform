import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { DriveDictationSessionSchema, UUIDv7 } from "@somnus/api-contracts";
import { SomnusError } from "@somnus/errors";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { SpeechConfigSchema } from "../src/modules/drive/speech/speech.config.js";
import {
  markedSsml,
  SpeechService,
  wordTimes,
} from "../src/modules/drive/speech/speech.service.js";

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

  it("accepts AssemblyAI's real tokens, signed JWTs well over a kilobyte", async () => {
    const jwt = `eyJ${"a".repeat(1500)}.${"b".repeat(400)}.${"c".repeat(86)}`;
    const http = vi.fn().mockResolvedValue(json({ token: jwt }));
    const session = await new SpeechService(configured, http).dictationSession("es");
    expect(new URL(session.url).searchParams.get("token")).toBe(jwt);
    expect(DriveDictationSessionSchema.safeParse(session).success).toBe(true);
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

  it("reads a passage with the worker's own identity, and says when each word is spoken", async () => {
    const http = vi.fn().mockResolvedValue(
      json({
        audioContent: "SUQzBAAA",
        timepoints: [
          { markName: "0", timeSeconds: 0.01 },
          { markName: "1", timeSeconds: 0.38 },
        ],
      }),
    );
    const token = vi.fn().mockResolvedValue("ya29.worker");
    const result = await new SpeechService(configured, http, token).readAloud(
      "Hola, equipo.",
      "es",
    );

    expect(result).toEqual({
      mime: "audio/mpeg",
      audio: "SUQzBAAA",
      words: [
        { start: 0, end: 5, time: 0.01 },
        { start: 6, end: 13, time: 0.38 },
      ],
    });
    const [url, init] = http.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eu-texttospeech.googleapis.com/v1beta1/text:synthesize");
    expect(init.headers).toEqual({
      authorization: "Bearer ya29.worker",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      input: { ssml: '<speak><mark name="0"/>Hola, <mark name="1"/>equipo.</speak>' },
      voice: { languageCode: "es-ES", name: "es-ES-Neural2-A" },
      audioConfig: { audioEncoding: "MP3" },
      enableTimePointing: ["SSML_MARK"],
    });
  });

  it("reads Catalan with its own voice, in the EU too", async () => {
    const http = vi.fn().mockResolvedValue(json({ audioContent: "SUQz" }));
    const result = await new SpeechService(configured, http, async () => "t").readAloud(
      "Bon dia.",
      "ca",
    );
    const [url, init] = http.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eu-texttospeech.googleapis.com/v1beta1/text:synthesize");
    expect(JSON.parse(String(init.body)).voice).toEqual({
      languageCode: "ca-ES",
      name: "ca-ES-Standard-B",
    });
    // A voice that reports nothing still plays, without words.
    expect(result).toEqual({ mime: "audio/mpeg", audio: "SUQz" });
  });

  it("escapes the text inside the SSML, so markup in a document is read, not obeyed", () => {
    const { ssml, words } = markedSsml('Usa <break time="9s"/> & "comillas"');
    expect(ssml).not.toContain("<break");
    expect(ssml).toBe(
      '<speak><mark name="0"/>Usa <mark name="1"/>&#60;break <mark name="2"/>time=&#34;9s&#34;/&#62; <mark name="3"/>&#38; <mark name="4"/>&#34;comillas&#34;</speak>',
    );
    expect(words).toHaveLength(5);
  });

  it("marks fewer words when a long passage would not fit, and places the rest between", async () => {
    const text = "palabra ".repeat(450).trim();
    const http = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const ssml = JSON.parse(String(init.body)).input.ssml as string;
      expect(new TextEncoder().encode(ssml).length).toBeLessThanOrEqual(5000);
      const names = [...ssml.matchAll(/mark name="(\d+)"/g)].map((m) => Number(m[1]));
      return json({
        audioContent: "SUQz",
        timepoints: names.map((n) => ({ markName: String(n), timeSeconds: n / 2 })),
      });
    });
    const result = await new SpeechService(configured, http, async () => "t").readAloud(text, "es");
    expect(result.words).toHaveLength(450);
    // Every word has a time, rising through the passage.
    const times = (result.words ?? []).map((w) => w.time);
    expect(times.every((t, i) => i === 0 || t >= (times[i - 1] ?? 0))).toBe(true);
    expect(times[1]).toBeCloseTo(0.5, 5);
  });

  it("interpolates unmarked words by where they are in the text", () => {
    const words: Array<[number, number]> = [
      [0, 2],
      [3, 5],
      [6, 8],
    ];
    expect(
      wordTimes(
        words,
        new Map([
          [0, 1],
          [2, 3],
        ]),
      ).map((w) => w.time),
    ).toEqual([1, 2, 3]);
    expect(wordTimes(words, new Map())).toEqual([]);
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
