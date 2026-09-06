/**
 * Rules about how a batch moves through its stages, shared by the API and the
 * form so a limit is stated once rather than enforced twice with two numbers.
 */

/**
 * How many unfinished batches one furnace may carry.
 *
 * A heat is recorded in stages, which means paperwork can lag the metal. Past
 * a few open batches on the same furnace an operator stops being able to tell
 * which heat they are filling in, so the open ones have to be closed first.
 */
export const MAX_OPEN_BATCHES_PER_FURNACE = 3;
