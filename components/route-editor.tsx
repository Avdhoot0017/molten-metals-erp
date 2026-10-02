"use client";

import * as React from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ArrowLeft, ArrowRight, Flame, PackageCheck, X } from "lucide-react";

/**
 * The route a part's castings travel: furnace, then each station in turn, then
 * finished stock.
 *
 * Drawn rather than listed because the order IS the meaning here. A route is
 * the thing that lets ten pieces moving through three stations be counted as
 * ten pieces instead of thirty, and a picture of the line makes a wrong order
 * obvious in a way a list of dropdowns does not.
 *
 * The canvas is laid out by this component, not by dragging. Positions carry
 * no meaning - only the sequence does - so letting someone drag a node
 * somewhere would suggest a freedom that changes nothing. Order is changed
 * with the arrows on each station, which is unambiguous and works on a phone.
 */

export interface RouteStepValue {
  activityTypeId: string;
  name: string;
}

interface ProcessOption {
  id: string;
  name: string;
}

/** Fixed geometry - the canvas height is derived from it. */
const NODE_WIDTH = 168;
const NODE_GAP = 56;
const ROW_Y = 40;

type StationData = {
  label: string;
  position: number;
  total: number;
  editable: boolean;
  onRemove: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
};

type TerminalData = { label: string; hint: string; kind: "start" | "end" };

function StationNode({ data }: NodeProps<Node<StationData>>) {
  return (
    <div className="w-[168px] rounded-lg border border-[var(--primary)]/40 bg-[var(--card)] px-3 py-2 shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-[var(--primary)]" />
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Step {data.position}
          </p>
          <p className="truncate text-sm font-medium text-[var(--foreground)]">
            {data.label}
          </p>
        </div>
        {data.editable && (
          <button
            type="button"
            title="Remove this step"
            onClick={data.onRemove}
            className="cursor-pointer rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--error)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {data.editable && (
        <div className="mt-1.5 flex gap-1">
          <button
            type="button"
            title="Move earlier"
            disabled={data.position === 1}
            onClick={data.onMoveLeft}
            className="cursor-pointer rounded border border-[var(--border)] p-0.5 text-[var(--muted-foreground)] disabled:cursor-not-allowed disabled:opacity-30 hover:enabled:bg-[var(--muted)]"
          >
            <ArrowLeft className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="Move later"
            disabled={data.position === data.total}
            onClick={data.onMoveRight}
            className="cursor-pointer rounded border border-[var(--border)] p-0.5 text-[var(--muted-foreground)] disabled:cursor-not-allowed disabled:opacity-30 hover:enabled:bg-[var(--muted)]"
          >
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-[var(--primary)]" />
    </div>
  );
}

/** The furnace and finished stock - fixed ends the route always runs between. */
function TerminalNode({ data }: NodeProps<Node<TerminalData>>) {
  const start = data.kind === "start";
  return (
    <div
      className={`w-[168px] rounded-lg border px-3 py-2 ${
        start
          ? "border-amber-300 bg-amber-50"
          : "border-green-300 bg-green-50"
      }`}
    >
      {!start && (
        <Handle type="target" position={Position.Left} className="!bg-green-600" />
      )}
      <div className="flex items-center gap-1.5">
        {start ? (
          <Flame className="h-3.5 w-3.5 text-amber-700" />
        ) : (
          <PackageCheck className="h-3.5 w-3.5 text-green-700" />
        )}
        <p
          className={`text-sm font-medium ${
            start ? "text-amber-900" : "text-green-900"
          }`}
        >
          {data.label}
        </p>
      </div>
      <p
        className={`mt-0.5 text-[10px] ${
          start ? "text-amber-800" : "text-green-800"
        }`}
      >
        {data.hint}
      </p>
      {start && (
        <Handle type="source" position={Position.Right} className="!bg-amber-600" />
      )}
    </div>
  );
}

const nodeTypes = { station: StationNode, terminal: TerminalNode };

export function RouteEditor({
  value,
  processes,
  editable = true,
  height = 150,
  onChange,
}: {
  value: RouteStepValue[];
  processes: ProcessOption[];
  editable?: boolean;
  /** Canvas height. A dialog that gives the route its own step affords more. */
  height?: number;
  onChange: (steps: RouteStepValue[]) => void;
}) {
  const [toAdd, setToAdd] = React.useState("");

  // A process belongs at one place in a route, so anything already on the
  // canvas is off the menu - the database refuses a duplicate anyway
  const available = processes.filter(
    (p) => !value.some((s) => s.activityTypeId === p.id)
  );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const { nodes, edges } = React.useMemo(() => {
    const n: Node[] = [];
    const e: Edge[] = [];
    const x = (index: number) => index * (NODE_WIDTH + NODE_GAP);

    n.push({
      id: "start",
      type: "terminal",
      position: { x: x(0), y: ROW_Y },
      data: {
        label: "Cast",
        hint: "Good castings off the furnace",
        kind: "start",
      },
      draggable: false,
      selectable: false,
    });

    value.forEach((step, index) => {
      n.push({
        id: step.activityTypeId,
        type: "station",
        position: { x: x(index + 1), y: ROW_Y - 8 },
        data: {
          label: step.name,
          position: index + 1,
          total: value.length,
          editable,
          onRemove: () =>
            onChange(value.filter((s) => s.activityTypeId !== step.activityTypeId)),
          onMoveLeft: () => move(index, index - 1),
          onMoveRight: () => move(index, index + 1),
        },
        draggable: false,
        selectable: false,
      });
      e.push({
        id: `e${index}`,
        source: index === 0 ? "start" : value[index - 1].activityTypeId,
        target: step.activityTypeId,
        animated: true,
      });
    });

    n.push({
      id: "end",
      type: "terminal",
      position: { x: x(value.length + 1), y: ROW_Y },
      data: {
        label: "Ready",
        hint: "Finished, counted once",
        kind: "end",
      },
      draggable: false,
      selectable: false,
    });
    e.push({
      id: "e-end",
      source: value.length
        ? value[value.length - 1].activityTypeId
        : "start",
      target: "end",
      animated: true,
    });

    return { nodes: n, edges: e };
    // `move` and `onChange` are recreated every render by design - the node
    // data holds closures over the current value, which is what keeps the
    // buttons acting on what is on screen
  }, [value, editable, onChange]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="block text-sm font-medium text-[var(--foreground)]">
          Process route
        </span>
        {value.length > 0 && (
          <span className="text-xs text-[var(--muted-foreground)]">
            {value.length} step{value.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <p className="mb-2 mt-0.5 text-xs text-[var(--muted-foreground)]">
        The stations these castings pass through, in order. The same pieces move
        along this line - they are counted once, not once per station.
        {value.length > 2 && " Drag the canvas to reach the rest of the line."}
      </p>

      <div
        className="rounded-lg border border-[var(--border)] bg-[var(--muted)]"
        style={{ height }}
      >
        <ReactFlow
          /*
           * Re-frame whenever the line gets longer or shorter.
           *
           * fitView only runs when the canvas initialises, so adding a station
           * to a route that already filled the width pushed it off the edge
           * and left it there. Keying on the number of nodes remounts the
           * canvas, which re-centres it - cheap for a handful of nodes, and
           * the layout is derived anyway, so nothing is lost by it.
           */
          key={`route-${value.length}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          // Room around a short route so Cast and Ready are not against the
          // edges, and never blown up past their natural size
          fitViewOptions={{ padding: 0.2, minZoom: 0.3, maxZoom: 1 }}
          /*
           * Nodes stay put - only the sequence means anything, so dragging one
           * somewhere would suggest a freedom that changes nothing.
           *
           * The CANVAS does move: a long route runs off the edge, and until
           * now there was no way to reach the far end of it. Dragging pans in
           * both directions and the controls zoom and re-fit. The wheel is
           * left alone - it belongs to the dialog the canvas sits in.
           */
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          // The wheel scrolls the dialog; the canvas is moved by dragging
          preventScrolling={false}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={14} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {editable && (
        <div className="mt-2 flex items-end gap-2">
          <div className="flex-1">
            <Select
              options={available.map((p) => ({ value: p.id, label: p.name }))}
              value={toAdd}
              onChange={setToAdd}
              placeholder={
                available.length === 0
                  ? "Every process is already in this route"
                  : "Add a process to the end"
              }
              disabled={available.length === 0}
              className="h-11"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="h-11"
            disabled={!toAdd}
            onClick={() => {
              const process = processes.find((p) => p.id === toAdd);
              if (!process) return;
              onChange([
                ...value,
                { activityTypeId: process.id, name: process.name },
              ]);
              setToAdd("");
            }}
          >
            Add step
          </Button>
        </div>
      )}

      {value.length === 0 && (
        <p className="mt-2 text-xs text-amber-700">
          No route yet. Castings of this part cannot be tracked through the shop
          until its stations are listed here.
        </p>
      )}
    </div>
  );
}
