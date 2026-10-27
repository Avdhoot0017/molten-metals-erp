/**
 * What has been ordered, what has been made, and what is still owed.
 *
 * Four figures are asked of every part, and they only mean anything if they
 * are defined once and read the same way everywhere:
 *
 *   required   pieces customers have ordered - every line of every customer
 *              PO that points at this part, cancelled orders excluded
 *   completed  pieces that have been through the whole route. Not "worked on"
 *              - a casting fettled and then decored is ONE completed piece,
 *              which is the whole reason the stage ledger exists
 *   inProcess  pieces somewhere in the shop right now: queued at a station or
 *              on the repair bench
 *   pending    ordered, and not yet started
 *
 * They are meant to add up: completed + inProcess + pending = required,
 * unless more has been made than was ordered, which is what `surplus` says.
 *
 * `completed` is deliberately NOT read from the history of moves into
 * finished stock. It is `ready + dispatched` - what is still in the yard plus
 * what has left it - because those are two balances that can be counted by
 * hand against the shelves and the delivery notes. A figure nobody can
 * recount is a figure nobody will believe.
 */

export interface PartPieceCounts {
  /** Queued at a station. */
  waiting: number;
  /** On the repair bench. */
  rework: number;
  /** Finished, still with us. */
  ready: number;
}

export interface PartDemandInput extends PartPieceCounts {
  /** Ordered by customers, cancelled orders excluded. */
  required: number;
  /** Pieces that have gone out on a delivery note. */
  dispatched: number;
}

export interface PartDemandFigures extends PartDemandInput {
  /** Through the whole route, ever: what is here plus what has left. */
  completed: number;
  /** In the shop right now - queued plus on the repair bench. */
  inProcess: number;
  /** Ordered and not yet started. Never negative. */
  pending: number;
  /** Made beyond what was ordered. Stock, not a shortfall. */
  surplus: number;
  /** Ordered and not yet delivered. */
  outstanding: number;
  /** How far the order is served, 0-100. 100 when nothing is ordered. */
  progress: number;
}

export function demandFigures(input: PartDemandInput): PartDemandFigures {
  const completed = input.ready + input.dispatched;
  const inProcess = input.waiting + input.rework;

  return {
    ...input,
    completed,
    inProcess,
    // Floored at zero: making more than was ordered is surplus stock, not
    // negative work still to do
    pending: Math.max(0, input.required - completed - inProcess),
    surplus: Math.max(0, completed - input.required),
    outstanding: Math.max(0, input.required - input.dispatched),
    progress:
      input.required > 0
        ? Math.min(100, (completed / input.required) * 100)
        : 100,
  };
}

/** Adds a day's figures up across parts, for the headline row. */
export function sumDemand(rows: PartDemandFigures[]): PartDemandFigures {
  const total = rows.reduce<PartDemandInput>(
    (sum, row) => ({
      required: sum.required + row.required,
      dispatched: sum.dispatched + row.dispatched,
      waiting: sum.waiting + row.waiting,
      rework: sum.rework + row.rework,
      ready: sum.ready + row.ready,
    }),
    { required: 0, dispatched: 0, waiting: 0, rework: 0, ready: 0 }
  );
  return demandFigures(total);
}

/** Orders in this state are not a commitment and are left out of `required`. */
export const EXCLUDED_ORDER_STATUS = "CANCELLED" as const;

/**
 * The days a trend covers, oldest first, as plain YYYY-MM-DD keys.
 *
 * Every day is present whether or not anything happened on it - a chart that
 * skips quiet days draws a busy week and a dead week the same width.
 */
export function dayKeys(days: number, until: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(until);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    keys.push(dayKey(day));
  }
  return keys;
}

/** A date as the local YYYY-MM-DD the trend is grouped by. */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
