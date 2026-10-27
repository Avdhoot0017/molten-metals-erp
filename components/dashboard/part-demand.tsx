"use client";

import * as React from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ClipboardList,
  PackageCheck,
  Loader2,
  Hourglass,
  Users,
  TrendingUp,
  Truck,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal, ModalFooter } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatWeight } from "@/lib/utils";

/**
 * Part by part: what customers have ordered against what the shop has made.
 *
 * The four figures are defined once, server side, in lib/demand.ts - this
 * only draws them. The important one is `completed`: pieces that have been
 * all the way through the route, counted once however many benches they
 * passed. Summing each bench's output instead is exactly how ten castings
 * through two stations used to read as twenty.
 *
 * Its own component, and its own request, because it reads customer orders:
 * a role that may not see those gets the rest of the dashboard with this
 * section simply absent, rather than an error across the page.
 */

interface CustomerSlice {
  companyId: string;
  name: string;
  ordered: number;
  dispatched: number;
  outstanding: number;
  orders: number;
}

interface PartRow {
  id: string;
  partCode: string;
  name: string;
  weightPerPiece: number;
  required: number;
  completed: number;
  inProcess: number;
  pending: number;
  surplus: number;
  ready: number;
  dispatched: number;
  waiting: number;
  rework: number;
  outstanding: number;
  progress: number;
  customerCount: number;
  customers: CustomerSlice[];
}

interface DemandData {
  parts: PartRow[];
  totals: {
    required: number;
    completed: number;
    inProcess: number;
    pending: number;
    dispatched: number;
    ready: number;
    partsOrdered: number;
    customers: number;
    unmatchedOrderLines: number;
  };
  trend: Array<{ date: string; finished: number; dispatched: number }>;
  trendDays: number;
}

/** The green the chart is drawn in, and the fill under it. */
const GREEN = "#16a34a";

function nos(value: number): string {
  return value.toLocaleString("en-IN");
}

/** "12 Oct" - short enough for thirty ticks on one axis. */
function shortDay(key: string): string {
  const date = new Date(`${key}T00:00:00`);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function PartDemand() {
  const [data, setData] = React.useState<DemandData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  /** A role without access to customer orders simply does not see this. */
  const [isHidden, setIsHidden] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [onlyOrdered, setOnlyOrdered] = React.useState(true);
  const [details, setDetails] = React.useState<PartRow | null>(null);

  /*
   * Recharts measures its container, so it can only draw once the browser
   * has one. Holding it back until mount keeps the server-rendered markup
   * and the first client render identical.
   */
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/analytics/part-demand");
        if (response.status === 403) {
          setIsHidden(true);
          return;
        }
        const payload = await response.json();
        if (payload.success) setData(payload.data);
      } catch (error) {
        console.error("Error loading part demand:", error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  if (isHidden) return null;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const query = search.trim().toLowerCase();
  const rows = data.parts.filter((row) => {
    const matchesQuery =
      !query ||
      row.name.toLowerCase().includes(query) ||
      row.partCode.toLowerCase().includes(query) ||
      row.customers.some((c) => c.name.toLowerCase().includes(query));
    const matchesOrdered = !onlyOrdered || row.required > 0;
    return matchesQuery && matchesOrdered;
  });

  const peak = Math.max(...data.trend.map((d) => d.finished), 0);
  const finishedInPeriod = data.trend.reduce((sum, d) => sum + d.finished, 0);
  const dispatchedInPeriod = data.trend.reduce((sum, d) => sum + d.dispatched, 0);
  const bestDay = data.trend.reduce(
    (best, day) => (day.finished > best.finished ? day : best),
    data.trend[0] ?? { date: "", finished: 0, dispatched: 0 }
  );

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            Customer demand, part by part
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            What has been ordered against what the shop has finished. Every
            figure is pieces, and a piece is counted once however many benches
            it passed.
          </p>
        </div>
        <Link href="/customer-outward">
          <Button variant="outline" size="sm">
            <Truck className="mr-2 h-4 w-4" />
            Customer Outward
          </Button>
        </Link>
      </div>

      {/* The four figures, across every part */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Ordered by customers",
            value: nos(data.totals.required),
            hint: `${data.totals.partsOrdered} part${data.totals.partsOrdered === 1 ? "" : "s"} · ${data.totals.customers} customer${data.totals.customers === 1 ? "" : "s"}`,
            icon: ClipboardList,
          },
          {
            label: "Completed",
            value: nos(data.totals.completed),
            hint: `${nos(data.totals.ready)} on the shelf · ${nos(data.totals.dispatched)} gone out`,
            icon: PackageCheck,
          },
          {
            label: "In process",
            value: nos(data.totals.inProcess),
            hint: "at a bench or on repair right now",
            icon: Loader2,
          },
          {
            label: "Pending",
            value: nos(data.totals.pending),
            hint: "ordered and not yet started",
            icon: Hourglass,
          },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {card.label}
                  </p>
                  <p className="mt-1 text-3xl font-bold">{card.value}</p>
                  <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                    {card.hint}
                  </p>
                </div>
                <div className="shrink-0 rounded-lg bg-[var(--accent)] p-3">
                  <card.icon className="h-6 w-6 text-[var(--primary)]" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* A PO line with no part behind it cannot be counted against output,
          so it is said out loud rather than quietly left out */}
      {data.totals.unmatchedOrderLines > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {data.totals.unmatchedOrderLines} customer PO line
            {data.totals.unmatchedOrderLines === 1 ? " is" : "s are"} not
            matched to one of our parts, so {data.totals.unmatchedOrderLines === 1 ? "it is" : "they are"}{" "}
            not counted here. Open the order on{" "}
            <Link href="/customer-orders" className="font-medium underline">
              Customer POs
            </Link>{" "}
            and pick the part on each line.
          </span>
        </div>
      )}

      {/* How much the shop is finishing, day by day */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[var(--primary)]" />
            Pieces finished per day
          </CardTitle>
          <p className="text-sm text-[var(--muted-foreground)]">
            Castings that came off the last bench, over the past{" "}
            {data.trendDays} days. {nos(finishedInPeriod)} finished,{" "}
            {nos(dispatchedInPeriod)} sent out
            {bestDay.finished > 0
              ? ` · best day ${shortDay(bestDay.date)} with ${nos(bestDay.finished)}`
              : ""}
            .
          </p>
        </CardHeader>
        <CardContent>
          {peak === 0 ? (
            <div className="flex h-56 items-center justify-center text-sm text-[var(--muted-foreground)]">
              Nothing has been finished in the past {data.trendDays} days yet.
            </div>
          ) : (
            <div className="h-64 w-full">
              {mounted && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data.trend}
                    margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="finishedFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={GREEN} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={GREEN} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortDay}
                      tick={{ fontSize: 11 }}
                      stroke="var(--muted-foreground)"
                      // Thirty labels will not fit, so every third day is
                      // named and the rest are read off the line
                      interval={Math.max(0, Math.floor(data.trend.length / 10))}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11 }}
                      stroke="var(--muted-foreground)"
                      width={36}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      labelFormatter={(value) => shortDay(String(value))}
                      formatter={(value, name) => [
                        `${nos(Number(value ?? 0))} pieces`,
                        name === "finished" ? "Finished" : "Sent out",
                      ]}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="finished"
                      stroke={GREEN}
                      strokeWidth={2.5}
                      fill="url(#finishedFill)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="dispatched"
                      stroke="var(--muted-foreground)"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      fill="none"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* The part-by-part list */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-[var(--primary)]" />
              Requirement against output
            </CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                placeholder="Search part or customer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-56"
              />
              <Select
                options={[
                  { value: "ordered", label: "Parts on order" },
                  { value: "all", label: "Every part" },
                ]}
                value={onlyOrdered ? "ordered" : "all"}
                onChange={(value) => setOnlyOrdered(value === "ordered")}
                className="h-9 w-44"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Nothing on order"
              description="Record a customer PO and its parts will be tracked here against what the shop finishes."
            />
          ) : (
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[230px]">Part</TableHead>
                  {/*
                    * The four figures sit in equal-width columns with a rule
                    * down the left of the group, so the eye reads across one
                    * part and down one measure without counting headings.
                    */}
                  <TableHead className="w-[130px] border-l border-[var(--border)] text-right">
                    Required
                    <span className="block text-xs font-normal text-[var(--muted-foreground)]">
                      by customers
                    </span>
                  </TableHead>
                  <TableHead className="w-[130px] text-right">
                    Completed
                    <span className="block text-xs font-normal text-[var(--muted-foreground)]">
                      through the route
                    </span>
                  </TableHead>
                  <TableHead className="w-[130px] text-right">
                    In process
                    <span className="block text-xs font-normal text-[var(--muted-foreground)]">
                      on the floor
                    </span>
                  </TableHead>
                  <TableHead className="w-[130px] text-right">
                    Pending
                    <span className="block text-xs font-normal text-[var(--muted-foreground)]">
                      not started
                    </span>
                  </TableHead>
                  <TableHead className="w-[170px] border-l border-[var(--border)]">
                    Progress
                  </TableHead>
                  <TableHead className="w-[120px] text-right">
                    <span className="sr-only">Customer-wise details</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="py-3">
                      <p className="font-medium text-[var(--foreground)]">
                        {row.name}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {row.partCode} · {formatWeight(row.weightPerPiece)} each
                      </p>
                    </TableCell>

                    <TableCell className="border-l border-[var(--border)] py-3 text-right">
                      <p className="font-semibold tabular-nums">
                        {nos(row.required)}
                      </p>
                      {/*
                        * Every number cell keeps a second line, empty or not,
                        * so the figures stay on one baseline across the row.
                        */}
                      <p className="min-h-4 text-xs text-[var(--muted-foreground)]">
                        {row.customerCount === 0
                          ? "no orders"
                          : `${row.customerCount} customer${row.customerCount === 1 ? "" : "s"}`}
                      </p>
                    </TableCell>

                    <TableCell className="py-3 text-right">
                      <p className="font-semibold tabular-nums text-green-700">
                        {nos(row.completed)}
                      </p>
                      <p className="min-h-4 text-xs text-[var(--muted-foreground)]">
                        {nos(row.ready)} here · {nos(row.dispatched)} out
                      </p>
                    </TableCell>

                    <TableCell className="py-3 text-right">
                      <p className="font-semibold tabular-nums">
                        {nos(row.inProcess)}
                      </p>
                      <p className="min-h-4 text-xs text-amber-700">
                        {row.rework > 0 ? `${nos(row.rework)} on repair` : ""}
                      </p>
                    </TableCell>

                    <TableCell className="py-3 text-right">
                      {row.pending > 0 ? (
                        <p className="font-semibold tabular-nums text-amber-700">
                          {nos(row.pending)}
                        </p>
                      ) : row.required === 0 ? (
                        <p className="text-[var(--muted-foreground)]">-</p>
                      ) : (
                        <Badge variant="success">Covered</Badge>
                      )}
                      <p className="min-h-4 text-xs text-[var(--muted-foreground)]">
                        {row.surplus > 0 && row.required > 0
                          ? `${nos(row.surplus)} spare`
                          : ""}
                      </p>
                    </TableCell>

                    <TableCell className="border-l border-[var(--border)] py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
                          <div
                            className="h-full rounded-full bg-green-600"
                            style={{ width: `${Math.round(row.progress)}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-[var(--muted-foreground)]">
                          {Math.round(row.progress)}%
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="py-3 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDetails(row)}
                        disabled={row.customerCount === 0}
                        title={
                          row.customerCount === 0
                            ? "No customer has ordered this part"
                            : "Customer-wise breakdown"
                        }
                      >
                        <Users className="mr-1.5 h-4 w-4" />
                        Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Customer-wise breakdown for one part */}
      <Modal
        isOpen={details !== null}
        onClose={() => setDetails(null)}
        title={details ? `${details.name} - who wants it` : "Customer breakdown"}
        description={
          details
            ? `${details.partCode} · ${nos(details.required)} pieces ordered across ${details.customerCount} customer${details.customerCount === 1 ? "" : "s"}`
            : undefined
        }
        size="lg"
      >
        {details && (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pb-2 pr-1">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Ordered", value: details.required },
                { label: "Completed", value: details.completed },
                { label: "In process", value: details.inProcess },
                { label: "Pending", value: details.pending },
              ].map((figure) => (
                <div
                  key={figure.label}
                  className="rounded-lg border border-[var(--border)] p-3"
                >
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {figure.label}
                  </p>
                  <p className="mt-0.5 text-xl font-bold">{nos(figure.value)}</p>
                </div>
              ))}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">POs</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Sent out</TableHead>
                  <TableHead className="text-right">Still owed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {details.customers.map((customer) => (
                  <TableRow key={customer.companyId}>
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell className="text-right">{customer.orders}</TableCell>
                    <TableCell className="text-right">
                      {nos(customer.ordered)}
                    </TableCell>
                    <TableCell className="text-right">
                      {nos(customer.dispatched)}
                    </TableCell>
                    <TableCell className="text-right">
                      {customer.outstanding > 0 ? (
                        <span className="font-semibold text-amber-700">
                          {nos(customer.outstanding)}
                        </span>
                      ) : (
                        <Badge variant="success">Delivered</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <p className="text-xs text-[var(--muted-foreground)]">
              Finished stock is not held per customer - {nos(details.ready)}{" "}
              piece{details.ready === 1 ? "" : "s"} of this part{" "}
              {details.ready === 1 ? "is" : "are"} on the shelf and can go to
              whoever is loaded first.
            </p>
          </div>
        )}
        <ModalFooter>
          <Button
            variant="secondary"
            className="h-12"
            onClick={() => setDetails(null)}
          >
            Close
          </Button>
          {details && (
            <Link href={`/customer-outward?part=${details.id}`}>
              <Button className="h-12">
                <Truck className="mr-2 h-4 w-4" />
                Outward
              </Button>
            </Link>
          )}
        </ModalFooter>
      </Modal>
    </section>
  );
}
