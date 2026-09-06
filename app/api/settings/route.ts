import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { getSettings, saveSettings, settingsForForm } from "@/lib/settings";
import { parseWeightInput } from "@/lib/units";

// GET - the plant-wide settings, shaped for the form (weights in kg)
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canRead(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }

    const settings = await getSettings();
    return NextResponse.json({ success: true, data: settingsForForm(settings) });
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

// PUT - save the settings the form sent
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canWrite(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const body = await request.json();

    // The form works in kg; storage is grams, like every other weight
    const payload = { ...body };
    if (payload.lowStockThreshold !== undefined) {
      const raw = String(payload.lowStockThreshold).trim();
      if (raw === "" || !Number.isFinite(Number(raw))) {
        return NextResponse.json(
          { error: "Low stock threshold must be a number of kilograms" },
          { status: 400 }
        );
      }
      payload.lowStockThreshold = parseWeightInput(raw);
    }

    const { error } = await saveSettings(payload);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const settings = await getSettings();
    return NextResponse.json({ success: true, data: settingsForForm(settings) });
  } catch (error) {
    console.error("Error saving settings:", error);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
