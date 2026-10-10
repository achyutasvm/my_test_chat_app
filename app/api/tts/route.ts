import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const TTS_MODEL = "gemini-3.8-flash-tts";
const DEFAULT_VOICE = "Kore";
const MAX_TEXT_CHARS = 5000;

// Older Gemini TTS models return raw 16-bit little-endian PCM (mimeType like
// "audio/L16;codec=pcm;rate=24000") that browsers can't play directly, so
// wrap it in a WAV header.
function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API key not configured" },
        { status: 500 },
      );
    }

    const { text } = await request.json();
    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [
        { role: "user", parts: [{ text: text.slice(0, MAX_TEXT_CHARS) }] },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: DEFAULT_VOICE } },
        },
      },
    });

    const inline = response.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.data,
    )?.inlineData;
    if (!inline?.data) {
      return NextResponse.json(
        { error: "No audio generated" },
        { status: 502 },
      );
    }

    const bytes = Buffer.from(inline.data, "base64");
    const mimeType = inline.mimeType ?? "";
    const isRawPcm = /audio\/(l16|pcm)/i.test(mimeType);
    const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1]) || 24000;
    const body = isRawPcm ? pcmToWav(bytes, rate) : bytes;

    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": isRawPcm ? "audio/wav" : mimeType || "audio/wav",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TTS API error:", message);
    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 502 },
    );
  }
}
