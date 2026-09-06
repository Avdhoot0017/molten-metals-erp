import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import type { UserRole } from "@/types";

const VALID_ROLES: UserRole[] = [
  "ADMIN",
  "PRODUCTION_MANAGER",
  "FETTLING_MANAGER",
  "ACCOUNTS",
];

const MIN_PASSWORD_LENGTH = 8;

/** Never return password hashes to the client. */
const USER_FIELDS = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// GET - List users
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canRead(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have access to user management" },
        { status: 403 }
      );
    }

    const users = await prisma.user.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
      select: USER_FIELDS,
    });

    return NextResponse.json({ success: true, data: users });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

// POST - Create a user who can sign in
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canWrite(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have permission to manage users" },
        { status: 403 }
      );
    }

    const { name, email, password, role } = await request.json();

    if (!name?.trim() || !email?.trim() || !password) {
      return NextResponse.json(
        { error: "Name, email and password are required" },
        { status: 400 }
      );
    }
    if (!isValidEmail(email.trim())) {
      return NextResponse.json(
        { error: "Enter a valid email address" },
        { status: 400 }
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const normalisedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalisedEmail } });
    if (existing) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 }
      );
    }

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalisedEmail,
        password: await hashPassword(password),
        role,
      },
      select: USER_FIELDS,
    });

    return NextResponse.json({ success: true, data: user }, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}

// PUT - Update a user's details, role, status or password
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canWrite(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have permission to manage users" },
        { status: 403 }
      );
    }

    const { id, name, email, password, role, isActive } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Guard against locking yourself out of the app
    if (id === session.id) {
      if (isActive === false) {
        return NextResponse.json(
          { error: "You cannot deactivate your own account" },
          { status: 400 }
        );
      }
      if (role !== undefined && role !== user.role) {
        return NextResponse.json(
          { error: "You cannot change your own role" },
          { status: 400 }
        );
      }
    }

    // Keep at least one active admin at all times
    if (
      user.role === "ADMIN" &&
      ((role !== undefined && role !== "ADMIN") || isActive === false)
    ) {
      const otherActiveAdmins = await prisma.user.count({
        where: { role: "ADMIN", isActive: true, id: { not: id } },
      });
      if (otherActiveAdmins === 0) {
        return NextResponse.json(
          { error: "This is the last active admin, so it cannot be changed" },
          { status: 400 }
        );
      }
    }

    if (email !== undefined) {
      if (!isValidEmail(email.trim())) {
        return NextResponse.json(
          { error: "Enter a valid email address" },
          { status: 400 }
        );
      }
      const normalised = email.trim().toLowerCase();
      if (normalised !== user.email) {
        const clash = await prisma.user.findUnique({ where: { email: normalised } });
        if (clash) {
          return NextResponse.json(
            { error: "A user with this email already exists" },
            { status: 409 }
          );
        }
      }
    }

    if (password !== undefined && password !== "" && password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(email !== undefined ? { email: email.trim().toLowerCase() } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        // Blank means "leave the current password alone"
        ...(password ? { password: await hashPassword(password) } : {}),
      },
      select: USER_FIELDS,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

// DELETE - Deactivate a user. Their records reference them, so this is a soft
// delete; only a user who has created nothing is removed outright.
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canWrite(session, "settings")) {
      return NextResponse.json(
        { error: "You do not have permission to manage users" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }
    if (id === session.id) {
      return NextResponse.json(
        { error: "You cannot remove your own account" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.role === "ADMIN") {
      const otherActiveAdmins = await prisma.user.count({
        where: { role: "ADMIN", isActive: true, id: { not: id } },
      });
      if (otherActiveAdmins === 0) {
        return NextResponse.json(
          { error: "This is the last active admin, so it cannot be removed" },
          { status: 400 }
        );
      }
    }

    const [pos, production, logs, fettling] = await Promise.all([
      prisma.purchaseOrder.count({ where: { createdBy: id } }),
      prisma.productionRecord.count({ where: { createdBy: id } }),
      prisma.inventoryLog.count({ where: { createdBy: id } }),
      prisma.fettlingActivity.count({ where: { recordedBy: id } }),
    ]);
    const referenced = pos + production + logs + fettling;

    if (referenced > 0) {
      await prisma.user.update({ where: { id }, data: { isActive: false } });
      return NextResponse.json({
        success: true,
        deactivated: true,
        message: `User has ${referenced} linked record(s), so the account was deactivated instead of deleted`,
      });
    }

    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ success: true, deactivated: false });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
