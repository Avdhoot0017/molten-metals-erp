"use client";

import * as React from "react";
import {
  Settings,
  User,
  Shield,
  Database,
  Users,
  Save,
  Eye,
  EyeOff,
  Check,
  AlertTriangle,
  Info,
  X,
  Plus,
  Trash2,
  Edit2,
  Flame,
  Wrench,
  Layers,
  Loader2,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { USER_ROLES, USER_ROLE_LABELS, type UserRole } from "@/types";
import { LoadingSpinner } from "@/components/ui/loading";
import { gradeNameProblem, normaliseGradeName } from "@/lib/ingot";

type TabType =
  | "profile"
  | "security"
  | "system"
  | "alloys"
  | "furnaces"
  | "activities"
  | "users";

interface Furnace {
  id: string;
  name: string;
  isActive: boolean;
}

/**
 * An alloy this foundry runs.
 *
 * Grades are configured here rather than built in, because a heat charged
 * with three alloys comes out as a fourth: that fourth has to exist as a
 * material in its own right - held as scrap, charged into the next heat,
 * bought as ingot - and only the shop knows which alloys it runs.
 */
interface AlloyGradeRow {
  id: string;
  name: string;
  description: string | null;
  colorHex: string | null;
  sortOrder: number;
  isActive: boolean;
  canBePurchased: boolean;
  /** Element limits for the assay, or null when none are entered. */
  compositionSpec?: unknown;
}

/** One element limit as it is typed in the spec editor. */
interface SpecRowDraft {
  key: string;
  symbol: string;
  name: string;
  min: string;
  max: string;
}

interface ActivityTypeRow {
  id: string;
  name: string;
  isActive: boolean;
}

interface UserData {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = React.useState<TabType>("profile");

  /*
   * The alloy master. Retired grades are loaded too: history still names
   * them, so the list has to show that they exist and are simply no longer
   * offered.
   */
  const [alloys, setAlloys] = React.useState<AlloyGradeRow[]>([]);
  const [alloysLoading, setAlloysLoading] = React.useState(true);
  const [alloyError, setAlloyError] = React.useState<string | null>(null);
  const [alloyNotice, setAlloyNotice] = React.useState<string | null>(null);
  const [alloyBusy, setAlloyBusy] = React.useState(false);
  const [newAlloy, setNewAlloy] = React.useState({
    name: "",
    description: "",
    canBePurchased: true,
  });
  /*
   * The composition spec being edited, if any.
   *
   * Kept apart from the inline name edit: the limits are a table of their own
   * and belong in a dialog, while a name is a single box in the row.
   */
  const [specAlloy, setSpecAlloy] = React.useState<AlloyGradeRow | null>(null);
  const [specRows, setSpecRows] = React.useState<SpecRowDraft[]>([]);
  const [editingAlloyId, setEditingAlloyId] = React.useState<string | null>(null);
  const [editingAlloy, setEditingAlloy] = React.useState({
    name: "",
    description: "",
  });

  // Furnaces (bhattis) - admin managed, used by the production form
  const [furnaces, setFurnaces] = React.useState<Furnace[]>([]);
  const [furnacesLoading, setFurnacesLoading] = React.useState(true);
  const [furnaceError, setFurnaceError] = React.useState<string | null>(null);
  // An outcome worth reporting that is not a failure - e.g. a furnace that was
  // deactivated rather than deleted because batches still reference it
  const [furnaceNotice, setFurnaceNotice] = React.useState<string | null>(null);
  const [newFurnaceName, setNewFurnaceName] = React.useState("");
  const [editingFurnaceId, setEditingFurnaceId] = React.useState<string | null>(null);
  const [editingFurnaceName, setEditingFurnaceName] = React.useState("");
  const [furnaceBusy, setFurnaceBusy] = React.useState(false);

  // Fettling activity types - drive the employee assignment and daily sheet
  const [activities, setActivities] = React.useState<ActivityTypeRow[]>([]);
  const [activitiesLoading, setActivitiesLoading] = React.useState(true);
  const [activityError, setActivityError] = React.useState<string | null>(null);
  const [activityNotice, setActivityNotice] = React.useState<string | null>(null);
  const [newActivityName, setNewActivityName] = React.useState("");
  const [editingActivityId, setEditingActivityId] = React.useState<string | null>(null);
  const [editingActivityName, setEditingActivityName] = React.useState("");
  const [activityBusy, setActivityBusy] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [saveSuccess, setSaveSuccess] = React.useState(false);
  // A failed save has to say so - the old stub always reported success
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // Profile state
  const [profileData, setProfileData] = React.useState({
    name: "Admin User",
    email: "admin@moltenmetals.com",
    phone: "+91 98765 43210",
    designation: "System Administrator",
  });

  // Password state
  const [passwordData, setPasswordData] = React.useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswords, setShowPasswords] = React.useState({
    current: false,
    new: false,
    confirm: false,
    userForm: false,
  });

  // System settings
  const [systemSettings, setSystemSettings] = React.useState({
    companyName: "Molten Metals Pvt. Ltd.",
    plantName: "Main Plant - Pune",
    address: "123 Industrial Area, Phase 2, Pune, Maharashtra 411057",
    gstNumber: "27AABCM1234R1Z5",
    lowStockThreshold: "10",
    currency: "INR",
    weightUnit: "kg",
    dateFormat: "DD/MM/YYYY",
  });

  // Users management - backed by /api/users
  const [users, setUsers] = React.useState<UserData[]>([]);
  const [usersLoading, setUsersLoading] = React.useState(true);
  const [userError, setUserError] = React.useState<string | null>(null);
  const [userNotice, setUserNotice] = React.useState<string | null>(null);
  const [userBusy, setUserBusy] = React.useState(false);

  const [isUserModalOpen, setIsUserModalOpen] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<UserData | null>(null);
  const [newUserData, setNewUserData] = React.useState({
    name: "",
    email: "",
    password: "",
    role: "PRODUCTION_MANAGER" as UserRole,
  });

  const tabs = [
    { id: "profile" as TabType, label: "Profile", icon: User },
    { id: "security" as TabType, label: "Security", icon: Shield },
    { id: "system" as TabType, label: "System", icon: Database },
    { id: "alloys" as TabType, label: "Aluminium Types", icon: Layers },
    { id: "furnaces" as TabType, label: "Furnaces", icon: Flame },
    { id: "activities" as TabType, label: "Activities", icon: Wrench },
    { id: "users" as TabType, label: "Users", icon: Users },
  ];

  /**
   * One banner shape for the whole page.
   *
   * A failure and an outcome are different things - "could not delete" is red,
   * "deactivated instead of deleted" is amber - and previously both went into
   * the same error slot, where the next successful reload wiped them.
   */
  const Banner = ({
    tone,
    children,
  }: {
    tone: "error" | "notice";
    children: React.ReactNode;
  }) =>
    tone === "error" ? (
      <div className="flex items-start gap-2 rounded-lg border border-[var(--error)]/30 bg-red-50 p-3 text-sm text-[var(--error)]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{children}</span>
      </div>
    ) : (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{children}</span>
      </div>
    );

  /**
   * The result of a save, shown beside the button that caused it.
   *
   * There is a banner in the page header too, but every Save sits at the foot
   * of a long tab - by the time you have scrolled down to click it, the header
   * is off screen and the confirmation goes unseen.
   */
  const SaveResult = () =>
    saveError ? (
      <span className="flex items-center gap-1.5 text-sm text-[var(--error)]">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {saveError}
      </span>
    ) : saveSuccess ? (
      <span className="flex items-center gap-1.5 text-sm text-[var(--success)]">
        <Check className="h-4 w-4 shrink-0" />
        Saved
      </span>
    ) : null;

  /** Shared tail of every save: report the outcome the same way. */
  const finishSave = (error: string | null) => {
    setIsLoading(false);
    setSaveError(error);
    if (!error) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  /** Profile tab - the signed-in user's own details. */
  const handleSaveProfile = async () => {
    setIsLoading(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileData.name,
          email: profileData.email,
          phone: profileData.phone,
          designation: profileData.designation,
        }),
      });
      const result = await res.json();
      finishSave(result.success ? null : result.error || "Failed to save profile");
    } catch {
      finishSave("Failed to save profile");
    }
  };

  /** Security tab - change your own password. */
  const handleSavePassword = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setSaveError("The new passwords do not match");
      return;
    }
    if (!passwordData.currentPassword || !passwordData.newPassword) {
      setSaveError("Enter your current password and the new one");
      return;
    }

    setIsLoading(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/profile/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(passwordData),
      });
      const result = await res.json();
      if (result.success) {
        // Clearing the boxes is the visible sign it actually went through
        setPasswordData({
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
        });
      }
      finishSave(result.success ? null : result.error || "Failed to change password");
    } catch {
      finishSave("Failed to change password");
    }
  };

  /** System tab - plant-wide settings. */
  const handleSaveSystem = async () => {
    setIsLoading(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(systemSettings),
      });
      const result = await res.json();
      if (result.success) setSystemSettings(result.data);
      finishSave(result.success ? null : result.error || "Failed to save settings");
    } catch {
      finishSave("Failed to save settings");
    }
  };

  const handleAddUser = () => {
    setUserError(null);
    setEditingUser(null);
    setNewUserData({
      name: "",
      email: "",
      password: "",
      role: "PRODUCTION_MANAGER",
    });
    setIsUserModalOpen(true);
  };

  const handleEditUser = (user: UserData) => {
    setEditingUser(user);
    setNewUserData({
      name: user.name,
      email: user.email,
      password: "",
      role: user.role,
    });
    setIsUserModalOpen(true);
  };

  const loadUsers = React.useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      const result = await res.json();
      if (result.success) {
        setUsers(result.data || []);
        setUserError(null);
      } else {
        setUserError(result.error || "Failed to load users");
      }
    } catch {
      setUserError("Failed to load users");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void (async () => {
      await loadUsers();
    })();
  }, [loadUsers]);

  // The form used to open on hard-coded placeholder values, which read as
  // real settings. Load what is actually stored.
  React.useEffect(() => {
    void (async () => {
      try {
        const [settingsRes, profileRes] = await Promise.all([
          fetch("/api/settings"),
          fetch("/api/profile"),
        ]);
        const settings = await settingsRes.json();
        const profile = await profileRes.json();
        if (settings.success) setSystemSettings(settings.data);
        if (profile.success) {
          setProfileData({
            name: profile.data.name ?? "",
            email: profile.data.email ?? "",
            phone: profile.data.phone ?? "",
            designation: profile.data.designation ?? "",
          });
        }
      } catch {
        // Leaving the defaults visible is better than an empty form; a save
        // will report its own failure
      }
    })();
  }, []);

  const handleSaveUser = async () => {
    setUserBusy(true);
    setUserError(null);
    try {
      const res = await fetch("/api/users", {
        method: editingUser ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingUser ? { id: editingUser.id } : {}),
          name: newUserData.name,
          email: newUserData.email,
          role: newUserData.role,
          // On edit a blank password means "leave it unchanged"
          ...(newUserData.password ? { password: newUserData.password } : {}),
        }),
      });
      const result = await res.json();
      if (result.success) {
        await loadUsers();
        setIsUserModalOpen(false);
        setEditingUser(null);
      } else {
        setUserError(result.error || "Failed to save user");
      }
    } catch {
      setUserError("Failed to save user");
    } finally {
      setUserBusy(false);
    }
  };

  const handleToggleUserStatus = async (userId: string, isActive: boolean) => {
    setUserBusy(true);
    setUserError(null);
    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, isActive: !isActive }),
      });
      const result = await res.json();
      if (result.success) {
        await loadUsers();
      } else {
        setUserError(result.error || "Failed to update user");
      }
    } catch {
      setUserError("Failed to update user");
    } finally {
      setUserBusy(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setUserNotice(null);
    setUserBusy(true);
    setUserError(null);
    try {
      const res = await fetch(`/api/users?id=${userId}`, { method: "DELETE" });
      const result = await res.json();
      if (result.success) {
        // Reload first - it clears the banner, which would otherwise wipe the
        // message before anyone could read it
        await loadUsers();
        // An account with linked records is deactivated, not deleted. That is
        // the outcome, not a failure.
        if (result.message) setUserNotice(result.message);
      } else {
        setUserError(result.error || "Failed to remove user");
      }
    } catch {
      setUserError("Failed to remove user");
    } finally {
      setUserBusy(false);
    }
  };

  const renderProfileTab = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--foreground)] mb-4">
          Personal Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              Full Name
            </label>
            <Input
              value={profileData.name}
              onChange={(e) =>
                setProfileData({ ...profileData, name: e.target.value })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              Email Address
            </label>
            <Input
              type="email"
              value={profileData.email}
              onChange={(e) =>
                setProfileData({ ...profileData, email: e.target.value })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              Phone Number
            </label>
            <Input
              value={profileData.phone}
              onChange={(e) =>
                setProfileData({ ...profileData, phone: e.target.value })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              Designation
            </label>
            <Input
              value={profileData.designation}
              onChange={(e) =>
                setProfileData({ ...profileData, designation: e.target.value })
              }
            />
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-[var(--border)]">
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={handleSaveProfile} isLoading={isLoading}>
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
          <SaveResult />
        </div>
      </div>
    </div>
  );

  const renderSecurityTab = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--foreground)] mb-4">
          Change Password
        </h3>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              Current Password
            </label>
            <div className="relative">
              <Input
                type={showPasswords.current ? "text" : "password"}
                value={passwordData.currentPassword}
                onChange={(e) =>
                  setPasswordData({
                    ...passwordData,
                    currentPassword: e.target.value,
                  })
                }
                className="pr-10"
              />
              <button
                type="button"
                onClick={() =>
                  setShowPasswords({
                    ...showPasswords,
                    current: !showPasswords.current,
                  })
                }
                className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
              >
                {showPasswords.current ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              New Password
            </label>
            <div className="relative">
              <Input
                type={showPasswords.new ? "text" : "password"}
                value={passwordData.newPassword}
                onChange={(e) =>
                  setPasswordData({
                    ...passwordData,
                    newPassword: e.target.value,
                  })
                }
                className="pr-10"
              />
              <button
                type="button"
                onClick={() =>
                  setShowPasswords({
                    ...showPasswords,
                    new: !showPasswords.new,
                  })
                }
                className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
              >
                {showPasswords.new ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              Confirm New Password
            </label>
            <div className="relative">
              <Input
                type={showPasswords.confirm ? "text" : "password"}
                value={passwordData.confirmPassword}
                onChange={(e) =>
                  setPasswordData({
                    ...passwordData,
                    confirmPassword: e.target.value,
                  })
                }
                className="pr-10"
              />
              <button
                type="button"
                onClick={() =>
                  setShowPasswords({
                    ...showPasswords,
                    confirm: !showPasswords.confirm,
                  })
                }
                className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
              >
                {showPasswords.confirm ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-[var(--border)]">
        <h3 className="text-lg font-semibold text-[var(--foreground)] mb-4">
          Session Information
        </h3>
        <div className="bg-[var(--card)] p-4 rounded-lg border border-[var(--border)]">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[var(--muted-foreground)]">Last Login</p>
              <p className="font-medium text-[var(--foreground)]">
                Today at 09:30 AM
              </p>
            </div>
            <div>
              <p className="text-[var(--muted-foreground)]">IP Address</p>
              <p className="font-medium text-[var(--foreground)]">
                192.168.1.100
              </p>
            </div>
            <div>
              <p className="text-[var(--muted-foreground)]">Browser</p>
              <p className="font-medium text-[var(--foreground)]">
                Chrome on macOS
              </p>
            </div>
            <div>
              <p className="text-[var(--muted-foreground)]">Session Expires</p>
              <p className="font-medium text-[var(--foreground)]">In 7 days</p>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-[var(--border)]">
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={handleSavePassword} isLoading={isLoading}>
            <Save className="h-4 w-4 mr-2" />
            Update Password
          </Button>
          <SaveResult />
        </div>
      </div>
    </div>
  );

  const renderSystemTab = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--foreground)] mb-4">
          Company Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              Company Name
            </label>
            <Input
              value={systemSettings.companyName}
              onChange={(e) =>
                setSystemSettings({
                  ...systemSettings,
                  companyName: e.target.value,
                })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              Plant Name
            </label>
            <Input
              value={systemSettings.plantName}
              onChange={(e) =>
                setSystemSettings({
                  ...systemSettings,
                  plantName: e.target.value,
                })
              }
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              Address
            </label>
            <Input
              value={systemSettings.address}
              onChange={(e) =>
                setSystemSettings({
                  ...systemSettings,
                  address: e.target.value,
                })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              GST Number
            </label>
            <Input
              value={systemSettings.gstNumber}
              onChange={(e) =>
                setSystemSettings({
                  ...systemSettings,
                  gstNumber: e.target.value,
                })
              }
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-[var(--foreground)] mb-4">
          System Preferences
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              Low Stock Threshold (kg)
            </label>
            <Input
              type="number"
              value={systemSettings.lowStockThreshold}
              onChange={(e) =>
                setSystemSettings({
                  ...systemSettings,
                  lowStockThreshold: e.target.value,
                })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              Currency
            </label>
            <select
              value={systemSettings.currency}
              onChange={(e) =>
                setSystemSettings({
                  ...systemSettings,
                  currency: e.target.value,
                })
              }
              className="w-full h-10 px-3 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
            >
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              Weight Unit
            </label>
            <Input
              value="Kilograms (kg)"
              disabled
              readOnly
              title="All weights across the application are displayed and entered in kilograms"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--muted-foreground)] mb-1">
              Date Format
            </label>
            <select
              value={systemSettings.dateFormat}
              onChange={(e) =>
                setSystemSettings({
                  ...systemSettings,
                  dateFormat: e.target.value,
                })
              }
              className="w-full h-10 px-3 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
            >
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-[var(--border)]">
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={handleSaveSystem} isLoading={isLoading}>
            <Save className="h-4 w-4 mr-2" />
            Save Settings
          </Button>
          <SaveResult />
        </div>
      </div>
    </div>
  );

  const renderUsersTab = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--foreground)]">
          User Management
        </h3>
        <Button onClick={handleAddUser}>
          <Plus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      {userError && <Banner tone="error">{userError}</Banner>}
      {userNotice && <Banner tone="notice">{userNotice}</Banner>}

      {usersLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--primary)]" />
        </div>
      ) : users.length === 0 ? (
        <div className="py-8 text-center text-[var(--muted-foreground)]">
          No users yet.
        </div>
      ) : (
      <div className="space-y-4">
        {users.map((user) => (
          <div
            key={user.id}
            className="flex items-center justify-between p-4 bg-[var(--card)] rounded-lg border border-[var(--border)]"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-[var(--primary)] flex items-center justify-center text-white font-semibold">
                {user.name.charAt(0)}
              </div>
              <div>
                <p className="font-medium text-[var(--foreground)]">
                  {user.name}
                </p>
                <p className="text-sm text-[var(--muted-foreground)]">
                  {user.email}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
                {USER_ROLE_LABELS[user.role]}
              </Badge>
              <Badge variant={user.isActive ? "success" : "error"}>
                {user.isActive ? "Active" : "Inactive"}
              </Badge>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleEditUser(user)}
                  className="cursor-pointer p-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] rounded-lg transition-colors"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleToggleUserStatus(user.id, user.isActive)}
                  disabled={userBusy}
                  title={user.isActive ? "Deactivate" : "Activate"}
                  className="cursor-pointer p-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] rounded-lg transition-colors"
                >
                  {user.isActive ? (
                    <X className="h-4 w-4" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={() => handleDeleteUser(user.id)}
                  disabled={userBusy}
                  title="Remove user"
                  className="cursor-pointer p-2 text-[var(--error)] hover:bg-[var(--error-light)] rounded-lg transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* User Modal */}
      <Modal
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
        title={editingUser ? "Edit User" : "Add New User"}
      >
        <div className="space-y-4">
          {userError && <Banner tone="error">{userError}</Banner>}

          {/* Using each component's own label keeps every field the same height */}
          <Input
            label="Full Name"
            value={newUserData.name}
            onChange={(e) =>
              setNewUserData({ ...newUserData, name: e.target.value })
            }
            placeholder="Enter full name"
          />

          <Input
            label="Email Address"
            type="email"
            value={newUserData.email}
            onChange={(e) =>
              setNewUserData({ ...newUserData, email: e.target.value })
            }
            placeholder="Enter email address"
          />

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
              {editingUser ? "New Password (optional)" : "Password"}
            </label>
            <div className="relative">
              <Input
                type={showPasswords.userForm ? "text" : "password"}
                value={newUserData.password}
                onChange={(e) =>
                  setNewUserData({ ...newUserData, password: e.target.value })
                }
                placeholder={
                  editingUser
                    ? "Leave blank to keep the current password"
                    : "At least 8 characters"
                }
                className="pr-10"
              />
              <button
                type="button"
                title={showPasswords.userForm ? "Hide password" : "Show password"}
                onClick={() =>
                  setShowPasswords({
                    ...showPasswords,
                    userForm: !showPasswords.userForm,
                  })
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                {showPasswords.userForm ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <Select
            label="Role"
            options={USER_ROLES.map((role) => ({
              value: role,
              label: USER_ROLE_LABELS[role],
            }))}
            value={newUserData.role}
            onChange={(value) =>
              setNewUserData({ ...newUserData, role: value as UserRole })
            }
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setIsUserModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveUser} isLoading={userBusy}>
              {editingUser ? "Update User" : "Add User"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );

  const loadFurnaces = React.useCallback(async () => {
    try {
      const res = await fetch("/api/furnaces?includeInactive=true");
      const result = await res.json();
      if (result.success) {
        setFurnaces(result.data || []);
        setFurnaceError(null);
      } else {
        setFurnaceError(result.error || "Failed to load furnaces");
      }
    } catch {
      setFurnaceError("Failed to load furnaces");
    } finally {
      setFurnacesLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void (async () => {
      await loadFurnaces();
    })();
  }, [loadFurnaces]);

  const loadAlloys = React.useCallback(async () => {
    try {
      const res = await fetch("/api/alloy-grades");
      const result = await res.json();
      if (result.success) {
        setAlloys(result.data || []);
        setAlloyError(null);
      } else {
        setAlloyError(result.error || "Failed to load the alloy list");
      }
    } catch {
      setAlloyError("Failed to load the alloy list");
    } finally {
      setAlloysLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadAlloys();
  }, [loadAlloys]);

  const handleAddAlloy = async () => {
    // Checked here as well as on the server so the message arrives as the
    // name is typed rather than after a round trip
    const problem = gradeNameProblem(newAlloy.name);
    if (problem) {
      setAlloyError(problem);
      return;
    }
    setAlloyBusy(true);
    setAlloyError(null);
    setAlloyNotice(null);
    try {
      const res = await fetch("/api/alloy-grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normaliseGradeName(newAlloy.name),
          description: newAlloy.description,
          canBePurchased: newAlloy.canBePurchased,
          sortOrder: alloys.length + 1,
        }),
      });
      const result = await res.json();
      if (result.success) {
        setNewAlloy({ name: "", description: "", canBePurchased: true });
        await loadAlloys();
        setAlloyNotice(
          `${result.data.name} added, with its four stock lines at zero.`
        );
      } else {
        setAlloyError(result.error || "Failed to add the alloy");
      }
    } catch {
      setAlloyError("Failed to add the alloy");
    } finally {
      setAlloyBusy(false);
    }
  };

  const handleUpdateAlloy = async (
    id: string,
    patch: {
      name?: string;
      description?: string;
      isActive?: boolean;
      canBePurchased?: boolean;
    }
  ) => {
    if (patch.name !== undefined) {
      const problem = gradeNameProblem(patch.name);
      if (problem) {
        setAlloyError(problem);
        return;
      }
    }
    setAlloyBusy(true);
    setAlloyError(null);
    setAlloyNotice(null);
    try {
      const res = await fetch("/api/alloy-grades", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const result = await res.json();
      if (result.success) {
        setEditingAlloyId(null);
        await loadAlloys();
      } else {
        setAlloyError(result.error || "Failed to save the alloy");
      }
    } catch {
      setAlloyError("Failed to save the alloy");
    } finally {
      setAlloyBusy(false);
    }
  };

  const handleDeleteAlloy = async (id: string) => {
    setAlloyBusy(true);
    setAlloyError(null);
    setAlloyNotice(null);
    try {
      const res = await fetch(`/api/alloy-grades?id=${id}`, { method: "DELETE" });
      const result = await res.json();
      if (result.success) {
        // Reload first: it clears the error banner, which would otherwise
        // wipe the notice a moment after it was set
        await loadAlloys();
        /*
         * An alloy with stock or history comes back retired rather than
         * deleted. That is the outcome, not a failure, so it reads as a
         * notice - and the message says why.
         */
        if (result.message) setAlloyNotice(result.message);
      } else {
        setAlloyError(result.error || "Failed to remove the alloy");
      }
    } catch {
      setAlloyError("Failed to remove the alloy");
    } finally {
      setAlloyBusy(false);
    }
  };

  /** Opens the limits dialog, showing whatever the alloy already carries. */
  const openSpecEditor = (alloy: AlloyGradeRow) => {
    const rows = Array.isArray(alloy.compositionSpec)
      ? (alloy.compositionSpec as Array<Record<string, unknown>>)
      : [];
    setSpecAlloy(alloy);
    setSpecRows(
      rows.length > 0
        ? rows.map((row, index) => ({
            key: `spec-${index}`,
            symbol: String(row.symbol ?? ""),
            name: String(row.name ?? ""),
            min: row.min === undefined || row.min === null ? "" : String(row.min),
            max: row.max === undefined || row.max === null ? "" : String(row.max),
          }))
        : [{ key: "spec-0", symbol: "", name: "", min: "", max: "" }]
    );
  };

  const handleSaveSpec = async () => {
    if (!specAlloy) return;
    const spec = specRows
      .filter((row) => row.symbol.trim() !== "")
      .map((row) => ({
        symbol: row.symbol.trim(),
        name: row.name.trim() || row.symbol.trim(),
        ...(row.min.trim() !== "" ? { min: Number(row.min) } : {}),
        ...(row.max.trim() !== "" ? { max: Number(row.max) } : {}),
      }));
    for (const row of spec) {
      if (
        (row.min !== undefined && !Number.isFinite(row.min)) ||
        (row.max !== undefined && !Number.isFinite(row.max))
      ) {
        setAlloyError(`${row.symbol}: limits must be numbers`);
        return;
      }
      if (
        row.min !== undefined &&
        row.max !== undefined &&
        row.min > row.max
      ) {
        setAlloyError(`${row.symbol}: the minimum is above the maximum`);
        return;
      }
    }
    setAlloyBusy(true);
    setAlloyError(null);
    try {
      const res = await fetch("/api/alloy-grades", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: specAlloy.id,
          // An empty table clears the spec: readings are then recorded
          // without being judged, which is honest for an alloy nobody has
          // written limits for yet
          compositionSpec: spec.length > 0 ? spec : null,
        }),
      });
      const result = await res.json();
      if (result.success) {
        setSpecAlloy(null);
        await loadAlloys();
        setAlloyNotice(
          spec.length > 0
            ? `${result.data.name}: ${spec.length} element limit${spec.length === 1 ? "" : "s"} saved. Heats of this alloy are measured against them.`
            : `${result.data.name}: limits cleared. Its assays are recorded without being judged.`
        );
      } else {
        setAlloyError(result.error || "Failed to save the limits");
      }
    } catch {
      setAlloyError("Failed to save the limits");
    } finally {
      setAlloyBusy(false);
    }
  };

  const handleAddFurnace = async () => {
    if (!newFurnaceName.trim()) {
      setFurnaceError("Enter a furnace name");
      return;
    }
    setFurnaceBusy(true);
    setFurnaceError(null);
    try {
      const res = await fetch("/api/furnaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFurnaceName }),
      });
      const result = await res.json();
      if (result.success) {
        setNewFurnaceName("");
        await loadFurnaces();
      } else {
        setFurnaceError(result.error || "Failed to add furnace");
      }
    } catch {
      setFurnaceError("Failed to add furnace");
    } finally {
      setFurnaceBusy(false);
    }
  };

  const handleUpdateFurnace = async (
    id: string,
    patch: { name?: string; isActive?: boolean }
  ) => {
    setFurnaceBusy(true);
    setFurnaceError(null);
    try {
      const res = await fetch("/api/furnaces", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const result = await res.json();
      if (result.success) {
        setEditingFurnaceId(null);
        await loadFurnaces();
      } else {
        setFurnaceError(result.error || "Failed to update furnace");
      }
    } catch {
      setFurnaceError("Failed to update furnace");
    } finally {
      setFurnaceBusy(false);
    }
  };

  const handleDeleteFurnace = async (id: string) => {
    setFurnaceBusy(true);
    setFurnaceError(null);
    setFurnaceNotice(null);
    try {
      const res = await fetch(`/api/furnaces?id=${id}`, { method: "DELETE" });
      const result = await res.json();
      if (result.success) {
        // Reload FIRST: it clears the error banner on success, which used to
        // wipe this message a few milliseconds after it was set
        await loadFurnaces();
        // A furnace already used by a batch comes back deactivated, not
        // deleted. That is the outcome, not a failure - so it is a notice.
        if (result.message) setFurnaceNotice(result.message);
      } else {
        setFurnaceError(result.error || "Failed to remove furnace");
      }
    } catch {
      setFurnaceError("Failed to remove furnace");
    } finally {
      setFurnaceBusy(false);
    }
  };

  const renderAlloysTab = () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-lg font-semibold text-[var(--foreground)]">
          Aluminium Types
        </h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          The alloys this foundry runs. Each one holds four stock lines - ingot,
          runner &amp; raiser, spillage and rejected parts - and can be charged
          into a heat or declared as what a heat comes out as.
        </p>
      </div>

      {alloyError && <Banner tone="error">{alloyError}</Banner>}
      {alloyNotice && <Banner tone="notice">{alloyNotice}</Banner>}

      {/* Add */}
      <div className="rounded-lg border border-[var(--border)] p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            label="Alloy name"
            placeholder="e.g. LM10"
            value={newAlloy.name}
            onChange={(e) => setNewAlloy({ ...newAlloy, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAddAlloy();
            }}
            helperText="Letters, digits and hyphens - stored in capitals"
          />
          <Input
            label="Specification (optional)"
            placeholder="e.g. AlSi12 - general casting alloy"
            value={newAlloy.description}
            onChange={(e) =>
              setNewAlloy({ ...newAlloy, description: e.target.value })
            }
          />
          <Select
            label="Bought as ingot?"
            options={[
              { value: "yes", label: "Yes - appears on purchase orders" },
              { value: "no", label: "No - only comes out of the furnace" },
            ]}
            value={newAlloy.canBePurchased ? "yes" : "no"}
            onChange={(value) =>
              setNewAlloy({ ...newAlloy, canBePurchased: value === "yes" })
            }
          />
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={handleAddAlloy} disabled={alloyBusy}>
            <Plus className="mr-2 h-4 w-4" />
            Add Alloy
          </Button>
        </div>
      </div>

      {/* List */}
      {alloysLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--primary)]" />
        </div>
      ) : alloys.length === 0 ? (
        <div className="py-8 text-center text-[var(--muted-foreground)]">
          No alloys yet. Add one above.
        </div>
      ) : (
        <div className="space-y-2">
          {alloys.map((alloy) => (
            <div
              key={alloy.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] p-3"
            >
              <div className="rounded-lg bg-[var(--accent)] p-2">
                <Layers className="h-4 w-4 text-[var(--primary)]" />
              </div>

              {editingAlloyId === alloy.id ? (
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <Input
                    value={editingAlloy.name}
                    onChange={(e) =>
                      setEditingAlloy({ ...editingAlloy, name: e.target.value })
                    }
                    className="w-32"
                    autoFocus
                  />
                  <Input
                    value={editingAlloy.description}
                    placeholder="Specification"
                    onChange={(e) =>
                      setEditingAlloy({
                        ...editingAlloy,
                        description: e.target.value,
                      })
                    }
                    className="flex-1"
                  />
                </div>
              ) : (
                <div className="flex-1">
                  <span className="font-medium">{alloy.name}</span>
                  {alloy.description && (
                    <span className="ml-2 text-sm text-[var(--muted-foreground)]">
                      {alloy.description}
                    </span>
                  )}
                </div>
              )}

              {!alloy.canBePurchased && (
                <Badge variant="outline">Not bought in</Badge>
              )}
              <Badge variant={alloy.isActive ? "success" : "default"}>
                {alloy.isActive ? "Active" : "Retired"}
              </Badge>

              <div className="flex items-center gap-1">
                {editingAlloyId === alloy.id ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Save"
                      disabled={alloyBusy}
                      onClick={() =>
                        handleUpdateAlloy(alloy.id, {
                          name: editingAlloy.name,
                          description: editingAlloy.description,
                        })
                      }
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Cancel"
                      onClick={() => setEditingAlloyId(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Edit"
                      onClick={() => {
                        setEditingAlloyId(alloy.id);
                        setEditingAlloy({
                          name: alloy.name,
                          description: alloy.description ?? "",
                        });
                      }}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Composition limits"
                      onClick={() => openSpecEditor(alloy)}
                    >
                      <Wrench className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={
                        alloy.canBePurchased
                          ? "Stop offering this on purchase orders"
                          : "Offer this on purchase orders"
                      }
                      disabled={alloyBusy}
                      onClick={() =>
                        handleUpdateAlloy(alloy.id, {
                          canBePurchased: !alloy.canBePurchased,
                        })
                      }
                    >
                      <Database className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={alloy.isActive ? "Retire" : "Bring back"}
                      disabled={alloyBusy}
                      onClick={() =>
                        handleUpdateAlloy(alloy.id, { isActive: !alloy.isActive })
                      }
                    >
                      {alloy.isActive ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Remove"
                      disabled={alloyBusy}
                      onClick={() => handleDeleteAlloy(alloy.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Composition limits for one alloy */}
      <Modal
        isOpen={specAlloy !== null}
        onClose={() => setSpecAlloy(null)}
        title={specAlloy ? `${specAlloy.name} - composition limits` : "Limits"}
        description="What a heat of this alloy is measured against on the assay. Leave a limit blank where the spec does not set one."
        size="lg"
      >
        <div className="space-y-3">
          {specRows.map((row, index) => (
            <div key={row.key} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-3">
                <Input
                  label={index === 0 ? "Element" : undefined}
                  placeholder="Si"
                  value={row.symbol}
                  onChange={(e) =>
                    setSpecRows(
                      specRows.map((r) =>
                        r.key === row.key ? { ...r, symbol: e.target.value } : r
                      )
                    )
                  }
                />
              </div>
              <div className="col-span-4">
                <Input
                  label={index === 0 ? "Name" : undefined}
                  placeholder="Silicon"
                  value={row.name}
                  onChange={(e) =>
                    setSpecRows(
                      specRows.map((r) =>
                        r.key === row.key ? { ...r, name: e.target.value } : r
                      )
                    )
                  }
                />
              </div>
              <div className="col-span-2">
                <Input
                  label={index === 0 ? "Min %" : undefined}
                  type="number"
                  placeholder="-"
                  value={row.min}
                  onChange={(e) =>
                    setSpecRows(
                      specRows.map((r) =>
                        r.key === row.key ? { ...r, min: e.target.value } : r
                      )
                    )
                  }
                />
              </div>
              <div className="col-span-2">
                <Input
                  label={index === 0 ? "Max %" : undefined}
                  type="number"
                  placeholder="-"
                  value={row.max}
                  onChange={(e) =>
                    setSpecRows(
                      specRows.map((r) =>
                        r.key === row.key ? { ...r, max: e.target.value } : r
                      )
                    )
                  }
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Remove this element"
                  onClick={() =>
                    setSpecRows(specRows.filter((r) => r.key !== row.key))
                  }
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setSpecRows([
                ...specRows,
                {
                  key: `spec-${Date.now()}`,
                  symbol: "",
                  name: "",
                  min: "",
                  max: "",
                },
              ])
            }
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add element
          </Button>

          <p className="text-xs text-[var(--muted-foreground)]">
            With no limits entered, a heat of this alloy is measured against the
            LM6 grid, which is what every batch used to be judged by. Enter the
            alloy&apos;s own limits and they are used instead.
          </p>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setSpecAlloy(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveSpec} disabled={alloyBusy}>
              <Save className="mr-2 h-4 w-4" />
              Save limits
            </Button>
          </div>
        </div>
      </Modal>

      <p className="text-xs text-[var(--muted-foreground)]">
        An alloy that has stock or appears on a batch or a part cannot be
        deleted - removing it would take that history with it. It is retired
        instead: everything recorded against it still reads, and it stops
        being offered on new entries.
      </p>
    </div>
  );

  const renderFurnacesTab = () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-lg font-semibold text-[var(--foreground)]">
          Furnaces (Bhattis)
        </h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          These appear in the furnace list when recording a production batch.
        </p>
      </div>

      {furnaceError && <Banner tone="error">{furnaceError}</Banner>}
      {furnaceNotice && <Banner tone="notice">{furnaceNotice}</Banner>}

      {/* Add */}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Input
            label="New Furnace Name"
            placeholder="e.g. Furnace 3"
            value={newFurnaceName}
            onChange={(e) => setNewFurnaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAddFurnace();
            }}
          />
        </div>
        <Button onClick={handleAddFurnace} disabled={furnaceBusy}>
          <Plus className="mr-2 h-4 w-4" />
          Add Furnace
        </Button>
      </div>

      {/* List */}
      {furnacesLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--primary)]" />
        </div>
      ) : furnaces.length === 0 ? (
        <div className="py-8 text-center text-[var(--muted-foreground)]">
          No furnaces yet. Add one above.
        </div>
      ) : (
        <div className="space-y-2">
          {furnaces.map((furnace) => (
            <div
              key={furnace.id}
              className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3"
            >
              <div className="rounded-lg bg-[var(--accent)] p-2">
                <Flame className="h-4 w-4 text-[var(--primary)]" />
              </div>

              {editingFurnaceId === furnace.id ? (
                <Input
                  value={editingFurnaceName}
                  onChange={(e) => setEditingFurnaceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      void handleUpdateFurnace(furnace.id, { name: editingFurnaceName });
                    if (e.key === "Escape") setEditingFurnaceId(null);
                  }}
                  autoFocus
                />
              ) : (
                <span className="flex-1 font-medium">{furnace.name}</span>
              )}

              <Badge variant={furnace.isActive ? "success" : "default"}>
                {furnace.isActive ? "Active" : "Inactive"}
              </Badge>

              <div className="flex items-center gap-1">
                {editingFurnaceId === furnace.id ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Save name"
                      disabled={furnaceBusy}
                      onClick={() =>
                        handleUpdateFurnace(furnace.id, { name: editingFurnaceName })
                      }
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Cancel"
                      onClick={() => setEditingFurnaceId(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Rename"
                      onClick={() => {
                        setEditingFurnaceId(furnace.id);
                        setEditingFurnaceName(furnace.name);
                      }}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={furnace.isActive ? "Deactivate" : "Activate"}
                      disabled={furnaceBusy}
                      onClick={() =>
                        handleUpdateFurnace(furnace.id, { isActive: !furnace.isActive })
                      }
                    >
                      {furnace.isActive ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Remove"
                      disabled={furnaceBusy}
                      onClick={() => handleDeleteFurnace(furnace.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const loadActivities = React.useCallback(async () => {
    try {
      const res = await fetch("/api/activity-types?includeInactive=true");
      const result = await res.json();
      if (result.success) {
        setActivities(result.data || []);
        setActivityError(null);
      } else {
        setActivityError(result.error || "Failed to load activities");
      }
    } catch {
      setActivityError("Failed to load activities");
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void (async () => {
      await loadActivities();
    })();
  }, [loadActivities]);

  const handleAddActivity = async () => {
    if (!newActivityName.trim()) {
      setActivityError("Enter an activity name");
      return;
    }
    setActivityBusy(true);
    setActivityError(null);
    try {
      const res = await fetch("/api/activity-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newActivityName }),
      });
      const result = await res.json();
      if (result.success) {
        setNewActivityName("");
        await loadActivities();
      } else {
        setActivityError(result.error || "Failed to add activity");
      }
    } catch {
      setActivityError("Failed to add activity");
    } finally {
      setActivityBusy(false);
    }
  };

  const handleUpdateActivity = async (
    id: string,
    patch: { name?: string; isActive?: boolean }
  ) => {
    setActivityBusy(true);
    setActivityError(null);
    try {
      const res = await fetch("/api/activity-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const result = await res.json();
      if (result.success) {
        setEditingActivityId(null);
        await loadActivities();
      } else {
        setActivityError(result.error || "Failed to update activity");
      }
    } catch {
      setActivityError("Failed to update activity");
    } finally {
      setActivityBusy(false);
    }
  };

  const handleDeleteActivity = async (id: string) => {
    setActivityBusy(true);
    setActivityError(null);
    setActivityNotice(null);
    try {
      const res = await fetch(`/api/activity-types?id=${id}`, { method: "DELETE" });
      const result = await res.json();
      if (result.success) {
        await loadActivities();
        // An operation with recorded entries is deactivated, not deleted
        if (result.message) setActivityNotice(result.message);
      } else {
        setActivityError(result.error || "Failed to remove activity");
      }
    } catch {
      setActivityError("Failed to remove activity");
    } finally {
      setActivityBusy(false);
    }
  };

  const renderActivitiesTab = () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-lg font-semibold text-[var(--foreground)]">
          Fettling Activities
        </h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          Employees are assigned to one of these, and the daily sheet records
          output against them.
        </p>
      </div>

      {activityError && <Banner tone="error">{activityError}</Banner>}
      {activityNotice && <Banner tone="notice">{activityNotice}</Banner>}

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Input
            label="New Activity Name"
            placeholder="e.g. Shot Blasting"
            value={newActivityName}
            onChange={(e) => setNewActivityName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAddActivity();
            }}
          />
        </div>
        <Button onClick={handleAddActivity} disabled={activityBusy}>
          <Plus className="mr-2 h-4 w-4" />
          Add Activity
        </Button>
      </div>

      {activitiesLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--primary)]" />
        </div>
      ) : activities.length === 0 ? (
        <div className="py-8 text-center text-[var(--muted-foreground)]">
          No activities yet. Add one above.
        </div>
      ) : (
        <div className="space-y-2">
          {activities.map((activity) => (
            <div
              key={activity.id}
              className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3"
            >
              <div className="rounded-lg bg-[var(--accent)] p-2">
                <Wrench className="h-4 w-4 text-[var(--primary)]" />
              </div>

              {editingActivityId === activity.id ? (
                <Input
                  value={editingActivityName}
                  onChange={(e) => setEditingActivityName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      void handleUpdateActivity(activity.id, {
                        name: editingActivityName,
                      });
                    if (e.key === "Escape") setEditingActivityId(null);
                  }}
                  autoFocus
                />
              ) : (
                <span className="flex-1 font-medium">{activity.name}</span>
              )}

              <Badge variant={activity.isActive ? "success" : "default"}>
                {activity.isActive ? "Active" : "Inactive"}
              </Badge>

              <div className="flex items-center gap-1">
                {editingActivityId === activity.id ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Save name"
                      disabled={activityBusy}
                      onClick={() =>
                        handleUpdateActivity(activity.id, {
                          name: editingActivityName,
                        })
                      }
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Cancel"
                      onClick={() => setEditingActivityId(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Rename"
                      onClick={() => {
                        setEditingActivityId(activity.id);
                        setEditingActivityName(activity.name);
                      }}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={activity.isActive ? "Deactivate" : "Activate"}
                      disabled={activityBusy}
                      onClick={() =>
                        handleUpdateActivity(activity.id, {
                          isActive: !activity.isActive,
                        })
                      }
                    >
                      {activity.isActive ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Remove"
                      disabled={activityBusy}
                      onClick={() => handleDeleteActivity(activity.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case "profile":
        return renderProfileTab();
      case "security":
        return renderSecurityTab();
      case "system":
        return renderSystemTab();
      case "furnaces":
        return renderFurnacesTab();
      case "alloys":
        return renderAlloysTab();
      case "activities":
        return renderActivitiesTab();
      case "users":
        return renderUsersTab();
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Settings
          </h1>
          <p className="text-[var(--muted-foreground)]">
            Manage your account and system preferences
          </p>
        </div>
        {saveError ? (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-2 text-[var(--error)]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{saveError}</span>
          </div>
        ) : saveSuccess ? (
          <div className="flex items-center gap-2 px-4 py-2 bg-[var(--success-light)] text-[var(--success)] rounded-lg">
            <Check className="h-4 w-4" />
            <span>Changes saved successfully</span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar Tabs */}
        <div className="lg:w-64 flex-shrink-0">
          <Card>
            <CardContent className="p-2">
              <nav className="space-y-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                      activeTab === tab.id
                        ? "bg-[var(--primary)] text-white"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    <tab.icon className="h-5 w-5" />
                    <span className="font-medium">{tab.label}</span>
                  </button>
                ))}
              </nav>
            </CardContent>
          </Card>
        </div>

        {/* Content Area */}
        <div className="flex-1">
          <Card>
            <CardContent className="p-6">{renderTabContent()}</CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
