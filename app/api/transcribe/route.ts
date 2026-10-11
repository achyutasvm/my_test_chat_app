import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const TRANSCRIBE_MODEL = "gemini-3.6-flash";

// Inline audio must stay under Gemini's ~20MB request limit; a minute of
// browser-recorded opus is well under 1MB, so this only guards against abuse.
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API key not configured" },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const audio = formData.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) {
      return NextResponse.json({ error: "No audio provided" }, { status: 400 });
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "Recording is too long" },
        { status: 413 },
      );
    }

    // MediaRecorder reports types like "audio/webm;codecs=opus"; Gemini
    // only wants the base MIME type.
    const mimeType = (audio.type || "audio/webm").split(";")[0];
    const data = Buffer.from(await audio.arrayBuffer()).toString("base64");

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: TRANSCRIBE_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data } },
            {
              text: "Transcribe this audio verbatim. Output only the transcribed text, with no commentary, labels, or quotation marks. If there is no intelligible speech, output nothing.",
            },
          ],
        },
      ],
      config: { temperature: 0 },
    });

    return NextResponse.json({ text: (response.text ?? "").trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Transcribe API error:", message);
    return NextResponse.json(
      { error: "Failed to transcribe audio" },
      { status: 502 },
    );
  }
}
