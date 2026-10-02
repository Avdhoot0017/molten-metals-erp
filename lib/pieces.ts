import type { Prisma, StageKind } from "@prisma/client";

/**
 * Moving pieces through the shop.
 *
 * The rule the whole thing rests on: a station's entry MOVES pieces, it does
 * not create them. Ten castings fettled and then decored are ten pieces at
 * decoring, not twenty parts in stock - which is exactly what the system used
 * to report, because it summed each station's output as if it were new.
 *
 * So every operation here is expressed as a set of deltas that sum to zero
 * across the stages, or to a deliberate exit (scrapped to the melt). Nothing
 * adds pieces except casting, and nothing removes them except scrapping.
 *
 * Counts are whole pieces - integers throughout. There is no such thing as
 * half a casting.
 */

/** Finished stock: through the whole route, counted once. */
export const READY_STAGE = "READY";

/** Pieces queued at a station, waiting to be worked. */
export function waitingKey(routeStepId: string): string {
  return `STEP:${routeStepId}`;
}

/** Pieces that failed at a station and went for repair rather than the melt. */
export function reworkKey(routeStepId: string): string {
  return `REWORK:${routeStepId}`;
}

/** The structured columns that go with a stage key, for querying and display. */
export function stageColumns(stageKey: string): {
  kind: StageKind;
  routeStepId: string | null;
} {
  if (stageKey === READY_STAGE) return { kind: "READY", routeStepId: null };
  if (stageKey.startsWith("REWORK:")) {
    return { kind: "REWORK", routeStepId: stageKey.slice(7) };
  }
  return { kind: "WAITING", routeStepId: stageKey.slice(5) };
}

/** An ordered route, as the movement helpers need it. */
export interface RouteStepRef {
  id: string;
  sequence: number;
  activityTypeId: string;
}

/**
 * Where pieces go when they leave a station having passed.
 *
 * The next station, or finished stock if this was the last one. A part with no
 * route at all never reaches here - its castings go straight to READY, because
 * there is no work defined to do to them.
 */
export function nextStageAfter(
  route: RouteStepRef[],
  stepId: string
): string {
  const index = route.findIndex((s) => s.id === stepId);
  const next = route[index + 1];
  return next ? waitingKey(next.id) : READY_STAGE;
}

/**
 * Where a batch's good castings land.
 *
 * The first station of the route, or straight into finished stock for a part
 * with no route - nothing has been defined to do to it, so it is done.
 */
export function entryStage(route: RouteStepRef[]): string {
  return route.length > 0 ? waitingKey(route[0].id) : READY_STAGE;
}

/** A movement map: stage key to signed piece count, per part. */
export type StageMoves = Map<string, Map<string, number>>;

/** Adds `delta` pieces at `stageKey` for `partId`, dropping it if it cancels out. */
export function addMove(
  moves: StageMoves,
  partId: string,
  stageKey: string,
  delta: number
): void {
  if (delta === 0) return;
  const forPart = moves.get(partId) ?? new Map<string, number>();
  const next = (forPart.get(stageKey) ?? 0) + delta;
  if (next === 0) forPart.delete(stageKey);
  else forPart.set(stageKey, next);
  if (forPart.size === 0) moves.delete(partId);
  else moves.set(partId, forPart);
}

/**
 * What a completed batch puts into the shop: its good castings, at the first
 * station of each part's route.
 *
 * Rejected castings are not here. They were scrapped at the furnace and booked
 * to the melt as metal; they never became pieces on the floor.
 */
export function productionMoves(
  items: Array<{ partId: string; goodParts: number }>,
  routes: Map<string, RouteStepRef[]>
): StageMoves {
  const moves: StageMoves = new Map();
  for (const item of items) {
    if (item.goodParts <= 0) continue;
    const route = routes.get(item.partId) ?? [];
    addMove(moves, item.partId, entryStage(route), item.goodParts);
  }
  return moves;
}

/**
 * One line of a day's work, in either of the two shapes it can take.
 *
 * Route work: pieces are taken from a station's queue and passed on.
 * Rework: pieces are taken from a station's REJECT queue and, if saved, put
 * back into the route.
 *
 * Exactly one of routeStepId and reworkFromStepId is set. Both null means the
 * line is not part of the piece flow at all - a part with no route, or an
 * entry recorded before routing existed.
 */
export interface PieceWorkLine {
  partId: string;
  routeStepId: string | null;
  /** The station whose rejects are being repaired, when this is rework. */
  reworkFromStepId?: string | null;
  /** Where repaired pieces rejoin the route - any step of it. Defaults to
   * the one that rejected them. */
  returnStepId?: string | null;
  partsCompleted: number;
  partsRejected: number;
  /** Of the rejects, how many went for repair rather than the melt. */
  reworkQty?: number;
}

/** How many of a line's rejects actually go into the furnace as scrap. */
export function meltedFrom(line: {
  partsRejected: number;
  reworkQty?: number;
}): number {
  return Math.max(0, line.partsRejected - (line.reworkQty ?? 0));
}

/**
 * What one day of work does to the piece counts.
 *
 * Route work moves pieces out of a station's queue: those that pass go to the
 * next station or to finished stock, those that fail go either to that
 * station's rework queue or out of the flow entirely, to the melt.
 *
 * Rework moves pieces out of a rework queue: those saved rejoin the route at
 * whichever step the bench sends them to, those that cannot be saved go to
 * the melt. A piece can be sent round the loop again on a later day, but
 * not within one entry - that would be a line reworking its own output.
 */
export function fettlingMoves(
  items: PieceWorkLine[],
  routes: Map<string, RouteStepRef[]>
): StageMoves {
  const moves: StageMoves = new Map();

  for (const item of items) {
    if (item.partsCompleted <= 0) continue;
    const route = routes.get(item.partId) ?? [];
    const accepted = Math.max(0, item.partsCompleted - item.partsRejected);

    if (item.reworkFromStepId) {
      // Repairing: out of the rework queue, back into the route if saved
      addMove(moves, item.partId, reworkKey(item.reworkFromStepId), -item.partsCompleted);
      const returnTo = item.returnStepId ?? item.reworkFromStepId;
      addMove(moves, item.partId, waitingKey(returnTo), accepted);
      // What could not be saved goes to the melt, leaving the piece flow
      continue;
    }

    // An entry with no station is not part of the piece flow. Its figures stay
    // in the labour reports and move nothing.
    if (!item.routeStepId) continue;

    // Everything worked leaves the queue, passed or failed
    addMove(moves, item.partId, waitingKey(item.routeStepId), -item.partsCompleted);
    // What passed moves on
    addMove(moves, item.partId, nextStageAfter(route, item.routeStepId), accepted);
    // What failed but is worth saving waits at this station's rework queue
    addMove(moves, item.partId, reworkKey(item.routeStepId), item.reworkQty ?? 0);
    // The remainder goes to the melt and is booked as metal
  }

  return moves;
}

/**
 * The difference between what an entry used to move and what it moves now.
 *
 * Amending is not "undo then redo": redoing would briefly leave the counts
 * wrong, and a concurrent read would see it. Only the change is applied, the
 * same shape the scrap and stock corrections already use.
 */
export function stageDelta(before: StageMoves, after: StageMoves): StageMoves {
  const deltas: StageMoves = new Map();
  const partIds = new Set([...before.keys(), ...after.keys()]);

  for (const partId of partIds) {
    const b = before.get(partId) ?? new Map<string, number>();
    const a = after.get(partId) ?? new Map<string, number>();
    for (const key of new Set([...b.keys(), ...a.keys()])) {
      addMove(deltas, partId, key, (a.get(key) ?? 0) - (b.get(key) ?? 0));
    }
  }

  return deltas;
}

/** Reverses a set of movements - for deleting a batch or a day's entry. */
export function reverseMoves(moves: StageMoves): StageMoves {
  return stageDelta(moves, new Map());
}

/** Names a stage for an error message, given the route it belongs to. */
export function describeStage(
  stageKey: string,
  route: RouteStepRef[],
  processNames: Map<string, string>
): string {
  if (stageKey === READY_STAGE) return "finished stock";
  const { kind, routeStepId } = stageColumns(stageKey);
  const step = route.find((s) => s.id === routeStepId);
  const name = step ? processNames.get(step.activityTypeId) ?? "that station" : "that station";
  return kind === "REWORK" ? `rework from ${name}` : name;
}

/**
 * Applies piece movements, refusing the whole set if any stage would go
 * negative.
 *
 * A negative balance is the duplication bug in another form: it means an entry
 * claims to have worked pieces that are not there - either more than the
 * station holds, or pieces a later station has already taken. Checking every
 * stage before writing any of them means a refusal leaves nothing half-applied.
 *
 * Returns a message on refusal, or null on success.
 */
export async function applyStageMoves(
  tx: Prisma.TransactionClient,
  moves: StageMoves,
  context: {
    reference: string;
    referenceId?: string | null;
    notes?: string | null;
    userId: string;
    /** Turns a stage key into something a person can read, for the refusal. */
    describe: (partId: string, stageKey: string) => string;
    /** Part codes for the refusal message. */
    partLabel: (partId: string) => string;
  }
): Promise<string | null> {
  // Check everything first, write nothing yet
  for (const [partId, stages] of moves) {
    for (const [stageKey, delta] of stages) {
      if (delta >= 0) continue;
      const existing = await tx.partStage.findUnique({
        where: { partId_stageKey: { partId, stageKey } },
      });
      const available = existing?.quantity ?? 0;
      if (available + delta < 0) {
        const place = context.describe(partId, stageKey);
        const part = context.partLabel(partId);
        // Two different mistakes produce this, and the message has to serve
        // both: working more pieces than the station holds, and taking back
        // pieces a later station has already moved on.
        return available === 0
          ? `No pieces of ${part} are at ${place} right now - they may already have been worked by the next station.`
          : `Only ${available} piece${available === 1 ? "" : "s"} of ${part} ${available === 1 ? "is" : "are"} at ${place}, and this needs ${-delta}.`;
      }
    }
  }

  for (const [partId, stages] of moves) {
    for (const [stageKey, delta] of stages) {
      const columns = stageColumns(stageKey);
      const existing = await tx.partStage.findUnique({
        where: { partId_stageKey: { partId, stageKey } },
      });
      const previousQty = existing?.quantity ?? 0;
      const newQty = previousQty + delta;

      await tx.partStage.upsert({
        where: { partId_stageKey: { partId, stageKey } },
        update: { quantity: newQty, lastUpdated: new Date() },
        create: {
          partId,
          stageKey,
          kind: columns.kind,
          routeStepId: columns.routeStepId,
          quantity: newQty,
        },
      });

      await tx.partStageLog.create({
        data: {
          partId,
          stageKey,
          quantity: delta,
          previousQty,
          newQty,
          reference: context.reference,
          referenceId: context.referenceId ?? null,
          notes: context.notes ?? null,
          createdBy: context.userId,
        },
      });
    }
  }

  return null;
}
