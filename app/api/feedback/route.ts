import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const CSV_PATH = path.join(process.cwd(), "feedback.csv");
const HEADER = "prompt,response,feedback\n";

function escapeCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, response, feedback } = await request.json();

    if (
      typeof prompt !== "string" ||
      typeof response !== "string" ||
      (feedback !== "up" && feedback !== "down")
    ) {
      return NextResponse.json(
        { error: "Invalid feedback payload" },
        { status: 400 }
      );
    }

    const row =
      [prompt, response, feedback].map(escapeCsvField).join(",") + "\n";

    let fileExists = true;
    try {
      await fs.access(CSV_PATH);
    } catch {
      fileExists = false;
    }

    await fs.appendFile(CSV_PATH, fileExists ? row : HEADER + row, "utf-8");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Feedback API error:", error);
    return NextResponse.json(
      { error: "Failed to save feedback" },
      { status: 500 }
    );
  }
}
