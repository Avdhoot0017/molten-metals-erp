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
  X,
  Plus,
  Trash2,
  Edit2,
  Flame,
  Wrench,
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

type TabType =
  | "profile"
  | "security"
  | "system"
  | "furnaces"
  | "activities"
  | "users";

interface Furnace {
  id: string;
  name: string;
  isActive: boolean;
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

  // Furnaces (bhattis) - admin managed, used by the production form
  const [furnaces, setFurnaces] = React.useState<Furnace[]>([]);
  const [furnacesLoading, setFurnacesLoading] = React.useState(true);
  const [furnaceError, setFurnaceError] = React.useState<string | null>(null);
  const [newFurnaceName, setNewFurnaceName] = React.useState("");
  const [editingFurnaceId, setEditingFurnaceId] = React.useState<string | null>(null);
  const [editingFurnaceName, setEditingFurnaceName] = React.useState("");
  const [furnaceBusy, setFurnaceBusy] = React.useState(false);

  // Fettling activity types - drive the employee assignment and daily sheet
  const [activities, setActivities] = React.useState<ActivityTypeRow[]>([]);
  const [activitiesLoading, setActivitiesLoading] = React.useState(true);
  const [activityError, setActivityError] = React.useState<string | null>(null);
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
    { id: "furnaces" as TabType, label: "Furnaces", icon: Flame },
    { id: "activities" as TabType, label: "Activities", icon: Wrench },
    { id: "users" as TabType, label: "Users", icon: Users },
  ];

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
    setUserBusy(true);
    setUserError(null);
    try {
      const res = await fetch(`/api/users?id=${userId}`, { method: "DELETE" });
      const result = await res.json();
      if (result.success) {
        if (result.message) setUserError(result.message);
        await loadUsers();
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
        <Button onClick={handleSaveProfile} isLoading={isLoading}>
          <Save className="h-4 w-4 mr-2" />
          Save Changes
        </Button>
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
        <Button onClick={handleSavePassword} isLoading={isLoading}>
          <Save className="h-4 w-4 mr-2" />
          Update Password
        </Button>
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
        <Button onClick={handleSaveSystem} isLoading={isLoading}>
          <Save className="h-4 w-4 mr-2" />
          Save Settings
        </Button>
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

      {userError && (
        <div className="rounded-lg bg-amber-100 p-3 text-sm text-amber-800">
          {userError}
        </div>
      )}

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
          {userError && (
            <div className="rounded-lg bg-red-100 p-3 text-sm text-red-700">
              {userError}
            </div>
          )}

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
    try {
      const res = await fetch(`/api/furnaces?id=${id}`, { method: "DELETE" });
      const result = await res.json();
      if (result.success) {
        // Furnaces already used by a batch come back deactivated, not deleted
        if (result.message) setFurnaceError(result.message);
        await loadFurnaces();
      } else {
        setFurnaceError(result.error || "Failed to remove furnace");
      }
    } catch {
      setFurnaceError("Failed to remove furnace");
    } finally {
      setFurnaceBusy(false);
    }
  };

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

      {furnaceError && (
        <div className="rounded-lg bg-amber-100 p-3 text-sm text-amber-800">
          {furnaceError}
        </div>
      )}

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
    try {
      const res = await fetch(`/api/activity-types?id=${id}`, { method: "DELETE" });
      const result = await res.json();
      if (result.success) {
        if (result.message) setActivityError(result.message);
        await loadActivities();
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

      {activityError && (
        <div className="rounded-lg bg-amber-100 p-3 text-sm text-amber-800">
          {activityError}
        </div>
      )}

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
