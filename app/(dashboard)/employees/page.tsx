"use client";

import * as React from "react";
import {
  HardHat,
  Plus,
  Search,
  Pencil,
  Repeat,
  UserX,
  Loader2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stat-card";
import { formatDate } from "@/lib/utils";
import type { ActivityType, Employee, UserRole } from "@/types";

const emptyForm = {
  employeeCode: "",
  name: "",
  phone: "",
  activityTypeId: "",
};

export default function EmployeesPage() {
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [role, setRole] = React.useState<UserRole | null>(null);
  const [isPageLoading, setIsPageLoading] = React.useState(true);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [searchQuery, setSearchQuery] = React.useState("");
  const [taskFilter, setTaskFilter] = React.useState("ALL");
  const [showInactive, setShowInactive] = React.useState(false);

  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [isEditOpen, setIsEditOpen] = React.useState(false);
  const [isReassignOpen, setIsReassignOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Employee | null>(null);
  const [formData, setFormData] = React.useState(emptyForm);
  const [newTask, setNewTask] = React.useState("");
  const [activityTypes, setActivityTypes] = React.useState<ActivityType[]>([]);

  // Admin and plant head onboard employees; the fettling manager only moves
  // them between operations.
  const canManage = role === "ADMIN" || role === "PRODUCTION_MANAGER";
  const canReassign = canManage || role === "FETTLING_MANAGER";

  const fetchData = React.useCallback(async () => {
    try {
      const [empRes, sessionRes, typesRes] = await Promise.all([
        fetch(`/api/employees?includeInactive=${showInactive}`),
        fetch("/api/auth/session"),
        fetch("/api/activity-types"),
      ]);
      const empData = await empRes.json();
      const sessionData = await sessionRes.json();
      const typesData = await typesRes.json();

      if (empData.success) setEmployees(empData.data || []);
      if (sessionData.success) setRole(sessionData.user.role);
      if (typesData.success) setActivityTypes(typesData.data || []);
    } catch (err) {
      console.error("Error fetching employees:", err);
      setError("Failed to load employees");
    } finally {
      setIsPageLoading(false);
    }
  }, [showInactive]);

  React.useEffect(() => {
    void (async () => {
      await fetchData();
    })();
  }, [fetchData]);

  const operationOptions = activityTypes.map((type) => ({
    value: type.id,
    label: type.name,
  }));

  const activityName = (employee: Employee) =>
    employee.activityType?.name ??
    activityTypes.find((t) => t.id === employee.activityTypeId)?.name ??
    "-";

  const filtered = employees.filter((e) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      e.name.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q);
    const matchesTask = taskFilter === "ALL" || e.activityTypeId === taskFilter;
    return matchesSearch && matchesTask;
  });

  const activeCount = employees.filter((e) => e.isActive).length;

  const countByTask = (typeId: string) =>
    employees.filter((e) => e.isActive && e.activityTypeId === typeId).length;

  const handleAdd = async () => {
    if (!formData.employeeCode.trim() || !formData.name.trim()) {
      setError("Employee code and name are required");
      return;
    }
    // Every employee must be assigned an activity
    if (!formData.activityTypeId) {
      setError("Select the activity this employee is assigned to");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const result = await res.json();
      if (result.success) {
        await fetchData();
        setIsAddOpen(false);
        setFormData(emptyForm);
      } else {
        setError(result.error || "Failed to add employee");
      }
    } catch {
      setError("Failed to add employee");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!selected) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/employees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, ...formData }),
      });
      const result = await res.json();
      if (result.success) {
        await fetchData();
        setIsEditOpen(false);
        setSelected(null);
      } else {
        setError(result.error || "Failed to update employee");
      }
    } catch {
      setError("Failed to update employee");
    } finally {
      setIsLoading(false);
    }
  };

  // Sends only activityTypeId, which the API allows for the fettling manager too
  const handleReassign = async () => {
    if (!selected) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/employees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, activityTypeId: newTask }),
      });
      const result = await res.json();
      if (result.success) {
        await fetchData();
        setIsReassignOpen(false);
        setSelected(null);
      } else {
        setError(result.error || "Failed to reassign task");
      }
    } catch {
      setError("Failed to reassign task");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeactivate = async (employee: Employee) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/employees?id=${employee.id}`, {
        method: "DELETE",
      });
      const result = await res.json();
      if (result.success) {
        await fetchData();
      } else {
        setError(result.error || "Failed to deactivate employee");
      }
    } catch {
      setError("Failed to deactivate employee");
    } finally {
      setIsLoading(false);
    }
  };

  if (isPageLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Employees</h1>
          <p className="text-[var(--muted-foreground)]">
            Shop-floor employees and their assigned fettling operation
          </p>
        </div>
        {canManage && (
          <Button onClick={() => { setFormData(emptyForm); setError(null); setIsAddOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Add Employee
          </Button>
        )}
      </div>

      {error && !isAddOpen && !isEditOpen && !isReassignOpen && (
        <div className="p-3 rounded-lg bg-red-100 text-red-700 text-sm">{error}</div>
      )}

      {/* Headcount by operation */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Active Employees" value={activeCount} icon={Users} />
        {activityTypes.map((type) => (
          <StatCard
            key={type.id}
            title={type.name}
            value={countByTask(type.id)}
            icon={HardHat}
            description="assigned"
          />
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Search grows to fill the row */}
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Search by name or employee code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Width sits on the wrapper - Input/Select pass className to the
                inner control, whose parent is always w-full */}
            <div className="w-full sm:w-52 shrink-0">
              <Select
                options={[{ value: "ALL", label: "All Operations" }, ...operationOptions]}
                value={taskFilter}
                onChange={setTaskFilter}
              />
            </div>

            {/* h-10 matches the input height so all three align on one line */}
            <label className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
              />
              Show inactive
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Employee table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5 text-[var(--primary)]" />
            Employee List
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-[var(--muted-foreground)]">
              No employees found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-3 px-4 font-semibold text-sm">Code</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Name</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Phone</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Assigned Task</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Joined</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Status</th>
                    <th className="text-right py-3 px-4 font-semibold text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((employee) => (
                    <tr
                      key={employee.id}
                      className="border-b border-[var(--border)] hover:bg-[var(--muted)]"
                    >
                      <td className="py-3 px-4">
                        <span className="font-mono text-sm bg-[var(--muted)] px-2 py-1 rounded">
                          {employee.employeeCode}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium">{employee.name}</td>
                      <td className="py-3 px-4 text-sm text-[var(--muted-foreground)]">
                        {employee.phone || "-"}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="info">
                          {activityName(employee)}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-[var(--muted-foreground)]">
                        {formatDate(new Date(employee.joinedAt))}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={employee.isActive ? "success" : "default"}>
                          {employee.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          {canReassign && employee.isActive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Change assigned task"
                              onClick={() => {
                                setSelected(employee);
                                setNewTask(employee.activityTypeId);
                                setError(null);
                                setIsReassignOpen(true);
                              }}
                            >
                              <Repeat className="h-4 w-4" />
                            </Button>
                          )}
                          {canManage && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Edit employee"
                                onClick={() => {
                                  setSelected(employee);
                                  setFormData({
                                    employeeCode: employee.employeeCode,
                                    name: employee.name,
                                    phone: employee.phone || "",
                                    activityTypeId: employee.activityTypeId,
                                  });
                                  setError(null);
                                  setIsEditOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {employee.isActive && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Deactivate employee"
                                  onClick={() => handleDeactivate(employee)}
                                >
                                  <UserX className="h-4 w-4" />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add employee */}
      <Modal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title="Add Employee"
        description="Register a shop-floor employee and assign their operation"
      >
        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-100 text-red-700 text-sm">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Employee Code"
              placeholder="e.g. EMP-001"
              value={formData.employeeCode}
              onChange={(e) => setFormData({ ...formData, employeeCode: e.target.value })}
            />
            <Input
              label="Phone (Optional)"
              placeholder="+91 ..."
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>
          <Input
            label="Full Name"
            placeholder="Employee name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <Select
            label="Assigned Activity"
            options={operationOptions}
            value={formData.activityTypeId}
            onChange={(v) => setFormData({ ...formData, activityTypeId: v })}
            placeholder="Select an activity"
          />
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsAddOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} isLoading={isLoading}>
            <Plus className="h-4 w-4 mr-2" />
            Add Employee
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit employee */}
      <Modal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title="Edit Employee"
        description={selected?.employeeCode}
      >
        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-100 text-red-700 text-sm">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Employee Code"
              value={formData.employeeCode}
              onChange={(e) => setFormData({ ...formData, employeeCode: e.target.value })}
            />
            <Input
              label="Phone (Optional)"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>
          <Input
            label="Full Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <Select
            label="Assigned Activity"
            options={operationOptions}
            value={formData.activityTypeId}
            onChange={(v) => setFormData({ ...formData, activityTypeId: v })}
            placeholder="Select an activity"
          />
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsEditOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleEdit} isLoading={isLoading}>
            Save Changes
          </Button>
        </ModalFooter>
      </Modal>

      {/* Reassign task */}
      <Modal
        isOpen={isReassignOpen}
        onClose={() => setIsReassignOpen(false)}
        title="Change Assigned Task"
        size="sm"
      >
        <div className="space-y-5">
          {error && (
            <div className="p-3 rounded-lg bg-red-100 text-red-700 text-sm">{error}</div>
          )}

          {/* Who is being moved */}
          <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]">
              <HardHat className="h-5 w-5 text-[var(--primary)]" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium text-[var(--foreground)]">
                {selected?.name}
              </p>
              <p className="font-mono text-xs text-[var(--muted-foreground)]">
                {selected?.employeeCode}
              </p>
            </div>
          </div>

          {/* Current -> new */}
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-[var(--foreground)]">
              Current Task
            </span>
            <Badge variant="default">
              {selected ? activityName(selected) : "-"}
            </Badge>
          </div>

          <Select
            label="Move To"
            options={operationOptions}
            value={newTask}
            onChange={setNewTask}
          />

          <p className="text-sm text-[var(--muted-foreground)]">
            Activity already recorded keeps the operation it was logged against.
          </p>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsReassignOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleReassign} isLoading={isLoading}>
            <Repeat className="h-4 w-4 mr-2" />
            Reassign
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
