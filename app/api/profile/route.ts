import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * The signed-in user's own profile.
 *
 * Every query is scoped to `session.id`, never to an id from the request body,
 * so one user can never read or edit another's account here. Managing other
 * people's accounts is /api/users, which requires settings write access.
 */

const PROFILE_FIELDS = {
  id: true,
  email: true,
  name: true,
  phone: true,
  designation: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// GET - the current user's profile
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: PROFILE_FIELDS,
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: user });
  } catch (error) {
    console.error("Error fetching profile:", error);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}

// PUT - update your own name / email. Role and status are deliberately not
// editable here; only an admin can change those via /api/users.
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, email, phone, designation } = await request.json();

    if (name !== undefined && !name.trim()) {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }

    if (email !== undefined) {
      if (!isValidEmail(email.trim())) {
        return NextResponse.json(
          { error: "Enter a valid email address" },
          { status: 400 }
        );
      }
      const normalised = email.trim().toLowerCase();
      const clash = await prisma.user.findUnique({ where: { email: normalised } });
      if (clash && clash.id !== session.id) {
        return NextResponse.json(
          { error: "That email is already in use" },
          { status: 409 }
        );
      }
    }

    const updated = await prisma.user.update({
      where: { id: session.id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(email !== undefined ? { email: email.trim().toLowerCase() } : {}),
        // Blank clears the field rather than storing an empty string
        ...(phone !== undefined ? { phone: String(phone).trim() || null } : {}),
        ...(designation !== undefined
          ? { designation: String(designation).trim() || null }
          : {}),
      },
      select: PROFILE_FIELDS,
    });

    // The session cookie carries the old name/email until the next sign-in
    return NextResponse.json({
      success: true,
      data: updated,
      note: "Sign out and back in to refresh the name shown in the header",
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
