import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import type { SessionUser, UserRole } from "@/types";
import { canWrite } from "./permissions";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "your-secret-key-change-in-production"
);

const COOKIE_NAME = "molten-metal-session";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

export async function createSession(user: SessionUser): Promise<string> {
  const token = await new SignJWT({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(JWT_SECRET);

  return token;
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      id: payload.id as string,
      email: payload.email as string,
      name: payload.name as string,
      role: payload.role as UserRole,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) return null;

  return verifySession(token);
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function loginUser(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string; user?: SessionUser }> {
  try {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user) {
      return { success: false, error: "Invalid email or password" };
    }

    if (!user.isActive) {
      return { success: false, error: "Account is deactivated" };
    }

    const isValid = await verifyPassword(password, user.password);

    if (!isValid) {
      return { success: false, error: "Invalid email or password" };
    }

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
    };

    const token = await createSession(sessionUser);
    await setSessionCookie(token);

    return { success: true, user: sessionUser };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, error: "An error occurred during login" };
  }
}

export async function registerUser(
  email: string,
  password: string,
  name: string,
  role: UserRole = "PRODUCTION_MANAGER"
): Promise<{ success: boolean; error?: string; user?: SessionUser }> {
  try {
    const normalisedEmail = email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({
      where: { email: normalisedEmail },
    });

    if (existingUser) {
      return { success: false, error: "Email already exists" };
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email: normalisedEmail,
        password: hashedPassword,
        name,
        role,
      },
    });

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
    };

    return { success: true, user: sessionUser };
  } catch (error) {
    console.error("Registration error:", error);
    return { success: false, error: "An error occurred during registration" };
  }
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === "ADMIN";
}

/*
 * Access checks live in lib/permissions.ts so nav, route guards and API routes
 * all read from the same matrix. These wrappers keep existing call sites working.
 */
export function canManageInventory(user: SessionUser | null): boolean {
  return canWrite(user, "inventory");
}

export function canManagePartsAndCompanies(user: SessionUser | null): boolean {
  return canWrite(user, "parts") && canWrite(user, "companies");
}

export function canManageEmployees(user: SessionUser | null): boolean {
  return canWrite(user, "employees");
}

export function canRecordFettlingActivity(user: SessionUser | null): boolean {
  return canWrite(user, "fettling");
}

export { canReassignEmployeeTask } from "./permissions";
