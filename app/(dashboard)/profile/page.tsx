"use client";

import * as React from "react";
import {
  User,
  Mail,
  Shield,
  Calendar,
  Save,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { USER_ROLE_LABELS, type UserRole } from "@/types";

interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

/** What each role can do, shown so a user understands their own access. */
const ROLE_SUMMARY: Record<UserRole, string> = {
  ADMIN: "Full access to every part of the system, including users and settings.",
  PRODUCTION_MANAGER:
    "Production, parts, companies, purchase orders, suppliers, analytics and settings.",
  FETTLING_MANAGER:
    "Employees, fettling activity, inventory, production and parts.",
  ACCOUNTS:
    "Read-only across operations, with full access to users and settings.",
};

export default function ProfilePage() {
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  // Details form
  const [details, setDetails] = React.useState({ name: "", email: "" });
  const [detailsError, setDetailsError] = React.useState<string | null>(null);
  const [detailsSaved, setDetailsSaved] = React.useState<string | null>(null);
  const [savingDetails, setSavingDetails] = React.useState(false);

  // Password form
  const [passwords, setPasswords] = React.useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswords, setShowPasswords] = React.useState({
    current: false,
    next: false,
    confirm: false,
  });
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = React.useState(false);
  const [savingPassword, setSavingPassword] = React.useState(false);

  const loadProfile = React.useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      const result = await res.json();
      if (result.success) {
        setProfile(result.data);
        setDetails({ name: result.data.name, email: result.data.email });
      } else {
        setDetailsError(result.error || "Failed to load profile");
      }
    } catch {
      setDetailsError("Failed to load profile");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void (async () => {
      await loadProfile();
    })();
  }, [loadProfile]);

  const handleSaveDetails = async () => {
    setSavingDetails(true);
    setDetailsError(null);
    setDetailsSaved(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: details.name, email: details.email }),
      });
      const result = await res.json();
      if (result.success) {
        await loadProfile();
        setDetailsSaved(result.note ?? "Profile updated");
      } else {
        setDetailsError(result.error || "Failed to update profile");
      }
    } catch {
      setDetailsError("Failed to update profile");
    } finally {
      setSavingDetails(false);
    }
  };

  const handleChangePassword = async () => {
    setSavingPassword(true);
    setPasswordError(null);
    setPasswordSaved(false);
    try {
      const res = await fetch("/api/profile/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(passwords),
      });
      const result = await res.json();
      if (result.success) {
        setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
        setPasswordSaved(true);
      } else {
        setPasswordError(result.error || "Failed to change password");
      }
    } catch {
      setPasswordError("Failed to change password");
    } finally {
      setSavingPassword(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--muted-foreground)]">
        {detailsError ?? "Profile unavailable"}
      </div>
    );
  }

  const detailsChanged =
    details.name !== profile.name || details.email !== profile.email;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">My Profile</h1>
        <p className="text-[var(--muted-foreground)]">
          Your account details and password
        </p>
      </div>

      {/* Identity summary */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-2xl font-bold text-white">
              {profile.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xl font-semibold text-[var(--foreground)]">
                {profile.name}
              </p>
              <p className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
                <Mail className="h-3.5 w-3.5" />
                {profile.email}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">
                <Shield className="mr-1 h-3 w-3" />
                {USER_ROLE_LABELS[profile.role]}
              </Badge>
              <Badge variant={profile.isActive ? "success" : "error"}>
                {profile.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Member since {formatDate(new Date(profile.createdAt))}
            </span>
          </div>

          <p className="mt-3 rounded-lg bg-[var(--muted)] p-3 text-sm text-[var(--muted-foreground)]">
            <span className="font-medium text-[var(--foreground)]">
              Your access:
            </span>{" "}
            {ROLE_SUMMARY[profile.role]}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Account details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-[var(--primary)]" />
              Account Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {detailsError && (
              <div className="rounded-lg bg-red-100 p-3 text-sm text-red-700">
                {detailsError}
              </div>
            )}
            {detailsSaved && (
              <div className="flex items-center gap-2 rounded-lg bg-[var(--success-light)] p-3 text-sm text-green-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {detailsSaved}
              </div>
            )}

            <Input
              label="Full Name"
              value={details.name}
              onChange={(e) => setDetails({ ...details, name: e.target.value })}
            />
            <Input
              label="Email Address"
              type="email"
              value={details.email}
              onChange={(e) => setDetails({ ...details, email: e.target.value })}
              helperText="You sign in with this address"
            />

            <div>
              <span className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                Role
              </span>
              <Input value={USER_ROLE_LABELS[profile.role]} disabled readOnly />
              <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
                Only an admin can change your role
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSaveDetails}
                isLoading={savingDetails}
                disabled={!detailsChanged}
              >
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Password */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-[var(--primary)]" />
              Change Password
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {passwordError && (
              <div className="rounded-lg bg-red-100 p-3 text-sm text-red-700">
                {passwordError}
              </div>
            )}
            {passwordSaved && (
              <div className="flex items-center gap-2 rounded-lg bg-[var(--success-light)] p-3 text-sm text-green-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Password changed. Use it the next time you sign in.
              </div>
            )}

            {(
              [
                { key: "currentPassword", toggle: "current", label: "Current Password" },
                { key: "newPassword", toggle: "next", label: "New Password" },
                { key: "confirmPassword", toggle: "confirm", label: "Confirm New Password" },
              ] as const
            ).map((field) => (
              <div key={field.key}>
                <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                  {field.label}
                </label>
                <div className="relative">
                  <Input
                    type={showPasswords[field.toggle] ? "text" : "password"}
                    value={passwords[field.key]}
                    onChange={(e) =>
                      setPasswords({ ...passwords, [field.key]: e.target.value })
                    }
                    placeholder={
                      field.key === "newPassword" ? "At least 8 characters" : undefined
                    }
                    className="pr-10"
                  />
                  <button
                    type="button"
                    title={showPasswords[field.toggle] ? "Hide password" : "Show password"}
                    onClick={() =>
                      setShowPasswords({
                        ...showPasswords,
                        [field.toggle]: !showPasswords[field.toggle],
                      })
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    {showPasswords[field.toggle] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}

            <div className="flex justify-end pt-2">
              <Button
                onClick={handleChangePassword}
                isLoading={savingPassword}
                disabled={
                  !passwords.currentPassword ||
                  !passwords.newPassword ||
                  !passwords.confirmPassword
                }
              >
                <Lock className="mr-2 h-4 w-4" />
                Update Password
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
