import { describe, expect, it } from "vitest";
import {
  DRIVE_READ_ALOUD_MAX_BYTES,
  DriveDictationSessionSchema,
  DriveReadAloudRequestSchema,
  DriveReadAloudResultSchema,
} from "./speech.js";

describe("Drive voice contracts", () => {
  it("only lets the browser dictate to AssemblyAI's streaming endpoint", () => {
    const ok = {
      url: "wss://streaming.eu.assemblyai.com/v3/ws?token=abc&sample_rate=16000",
      sampleRate: 16_000,
      expiresInSeconds: 60,
    };
    expect(DriveDictationSessionSchema.parse(ok)).toEqual(ok);
    for (const url of [
      "ws://streaming.eu.assemblyai.com/v3/ws?token=abc",
      "wss://evil.example/v3/ws?x=streaming.assemblyai.com",
      "wss://streaming.eu.assemblyai.com.evil.example/v3/ws?token=abc",
    ]) {
      expect(DriveDictationSessionSchema.safeParse({ ...ok, url }).success).toBe(false);
    }
  });

  it("bounds a passage to read aloud by bytes, as Google does", () => {
    expect(DriveReadAloudRequestSchema.safeParse({ text: "Hola", lang: "es" }).success).toBe(true);
    expect(DriveReadAloudRequestSchema.safeParse({ text: "", lang: "es" }).success).toBe(false);
    expect(DriveReadAloudRequestSchema.safeParse({ text: "Hola", lang: "de" }).success).toBe(false);
    // "ñ" is two bytes: half as many fit.
    const limit = "ñ".repeat(DRIVE_READ_ALOUD_MAX_BYTES / 2);
    expect(DriveReadAloudRequestSchema.safeParse({ text: limit, lang: "es" }).success).toBe(true);
    expect(DriveReadAloudRequestSchema.safeParse({ text: `${limit}a`, lang: "es" }).success).toBe(
      false,
    );
  });

  it("returns MP3 audio as base64", () => {
    expect(
      DriveReadAloudResultSchema.safeParse({ mime: "audio/mpeg", audio: "SUQz" }).success,
    ).toBe(true);
    expect(DriveReadAloudResultSchema.safeParse({ mime: "audio/wav", audio: "SUQz" }).success).toBe(
      false,
    );
  });
});
