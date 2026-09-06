import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();

    if (session) {
      return NextResponse.json({ success: true, user: session });
    } else {
      return NextResponse.json({ success: false, user: null });
    }
  } catch (error) {
    console.error("Session error:", error);
    return NextResponse.json(
      { success: false, error: "An error occurred" },
      { status: 500 }
    );
  }
}
