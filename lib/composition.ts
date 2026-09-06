/**
 * Free-form per-batch composition entries.
 *
 * Keys are user-defined (Si, Fe, Cu, or anything else the foundry records),
 * so this is stored as a JSON array rather than fixed columns.
 */

export interface CompositionEntry {
  key: string;
  value: string;
}

export const MAX_COMPOSITION_ENTRIES = 50;
const MAX_FIELD_LENGTH = 60;

/**
 * Validates and normalises whatever the client sent.
 * Returns the cleaned entries, or an error message describing the problem.
 */
export function parseComposition(
  input: unknown
): { entries: CompositionEntry[]; error: null } | { entries: null; error: string } {
  if (input === undefined || input === null || input === "") {
    return { entries: [], error: null };
  }

  if (!Array.isArray(input)) {
    return { entries: null, error: "Composition must be a list of entries" };
  }

  if (input.length > MAX_COMPOSITION_ENTRIES) {
    return {
      entries: null,
      error: `A batch can hold at most ${MAX_COMPOSITION_ENTRIES} composition entries`,
    };
  }

  const entries: CompositionEntry[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) {
      return { entries: null, error: "Each composition entry must have a key and a value" };
    }

    const key = String((raw as CompositionEntry).key ?? "").trim();
    const value = String((raw as CompositionEntry).value ?? "").trim();

    if (!key) {
      return { entries: null, error: "Composition entries need a field name" };
    }
    if (!value) {
      return { entries: null, error: `Enter a value for "${key}"` };
    }
    if (key.length > MAX_FIELD_LENGTH || value.length > MAX_FIELD_LENGTH) {
      return {
        entries: null,
        error: `Composition entries must be under ${MAX_FIELD_LENGTH} characters`,
      };
    }

    // Duplicate keys would make the record ambiguous
    const dedupeKey = key.toLowerCase();
    if (seen.has(dedupeKey)) {
      return { entries: null, error: `"${key}" is listed more than once` };
    }
    seen.add(dedupeKey);

    entries.push({ key, value });
  }

  return { entries, error: null };
}

/** Reads a stored JSON value back into typed entries, tolerating bad data. */
export function readComposition(value: unknown): CompositionEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const key = String((raw as CompositionEntry).key ?? "").trim();
    const val = String((raw as CompositionEntry).value ?? "").trim();
    return key && val ? [{ key, value: val }] : [];
  });
}

/**
 * Stored entries turned back into what the form's number inputs expect.
 *
 * Values are STORED with their unit - "12%" - because that is what the batch
 * record should read as. A number input cannot hold "12%" and silently renders
 * blank, so the unit is stripped here, at the one boundary where a stored
 * value becomes an editable one. The mirror of `buildCompositionEntries`.
 */
export function compositionToInputs(value: unknown): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const entry of readComposition(value)) {
    const stripped = entry.value.replace(/%/g, "").trim();
    if (stripped) inputs[entry.key] = stripped;
  }
  return inputs;
}

/**
 * LM6 (AlSi12) specification, as supplied by the foundry.
 *
 * These are the elements a batch is routinely assayed for, so the production
 * form offers them as fixed, named fields rather than making the operator type
 * the element name every time. Anything outside this list can still be added
 * as a free-form entry.
 *
 * The limits are recorded here so the form can flag a reading that falls
 * outside spec. They are advisory only - an out-of-spec heat is exactly the
 * kind of thing you still want written down.
 */
export interface AlloyElement {
  /** Chemical symbol, used as the stored entry key. */
  symbol: string;
  name: string;
  /** Limit exactly as printed on the spec sheet, shown under the field. */
  limit: string;
  min?: number;
  max?: number;
  /** Aluminium is whatever is left over, so it is computed, not typed. */
  isRemainder?: boolean;
}

export const LM6_ELEMENTS: AlloyElement[] = [
  { symbol: "Si", name: "Silicon", limit: "10.0 - 13.0%", min: 10, max: 13 },
  { symbol: "Fe", name: "Iron", limit: "0.6% max", max: 0.6 },
  { symbol: "Mn", name: "Manganese", limit: "0.5% max", max: 0.5 },
  { symbol: "Cu", name: "Copper", limit: "0.1% max", max: 0.1 },
  { symbol: "Mg", name: "Magnesium", limit: "0.10% max", max: 0.1 },
  { symbol: "Ni", name: "Nickel", limit: "0.1% max", max: 0.1 },
  { symbol: "Zn", name: "Zinc", limit: "0.1% max", max: 0.1 },
  { symbol: "Pb", name: "Lead", limit: "0.1% max", max: 0.1 },
  { symbol: "Sn", name: "Tin", limit: "0.05% max", max: 0.05 },
  { symbol: "Ti", name: "Titanium", limit: "0.2% max", max: 0.2 },
  { symbol: "Al", name: "Aluminium", limit: "Remainder", isRemainder: true },
];

/** Symbols and names that the fixed grid owns, for collision checks. */
export const LM6_RESERVED_KEYS = new Set(
  LM6_ELEMENTS.flatMap((e) => [e.symbol.toLowerCase(), e.name.toLowerCase()])
);

/**
 * Validates one typed reading. Returns an error for input that is not a
 * sensible percentage, or an advisory message when it is outside the LM6
 * limit. Blank is valid - the assay may not cover every element.
 */
export function checkElementValue(
  element: AlloyElement,
  raw: string
): { error: string | null; warning: string | null } {
  const value = raw.trim();
  if (!value) return { error: null, warning: null };

  const num = Number(value);
  if (!Number.isFinite(num)) return { error: "Enter a number", warning: null };
  if (num < 0) return { error: "Cannot be negative", warning: null };
  if (num > 100) return { error: "Cannot exceed 100%", warning: null };

  if (element.min !== undefined && num < element.min) {
    return { error: null, warning: `Below spec (min ${element.min}%)` };
  }
  if (element.max !== undefined && num > element.max) {
    return { error: null, warning: `Above spec (max ${element.max}%)` };
  }
  return { error: null, warning: null };
}

/**
 * Aluminium is the balance of the heat, so the form offers it as a computed
 * default. It is only ever a *suggestion*: an assay often covers a handful of
 * elements rather than all ten, and the balance then silently treats every
 * unmeasured element as zero. The operator can overwrite it with the figure
 * from the lab report, so this reports enough for the UI to explain itself.
 */
export interface AluminiumBalance {
  /** Sum of the non-aluminium readings actually entered. */
  total: number;
  /** How many of those fields were filled in. */
  entered: number;
  /** 100 - total, or null when nothing has been entered yet. */
  balance: number | null;
  /** True when the readings already add up to more than 100%. */
  overflow: boolean;
}

export function aluminiumBalance(values: Record<string, string>): AluminiumBalance {
  let total = 0;
  let entered = 0;

  for (const element of LM6_ELEMENTS) {
    if (element.isRemainder) continue;
    const raw = (values[element.symbol] ?? "").trim();
    if (!raw) continue;
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) continue;
    total += num;
    entered++;
  }

  total = Number(total.toFixed(3));
  if (entered === 0) {
    return { total: 0, entered: 0, balance: null, overflow: false };
  }
  // A negative balance is not a reading, it is a sign the numbers are wrong,
  // so it is reported as an overflow rather than shown as "-20%".
  return {
    total,
    entered,
    balance: Number((100 - total).toFixed(3)),
    overflow: total > 100,
  };
}

/**
 * Folds the fixed element grid and the free-form entries into the single list
 * that gets stored. Elements come first and in spec-sheet order so a batch
 * always reads the same way.
 */
export function buildCompositionEntries(
  elementValues: Record<string, string>,
  /**
   * Extra entries outside the LM6 table. The production form no longer offers
   * these, but older batches were saved with them and `parseComposition` still
   * accepts them, so the parameter stays.
   */
  custom: CompositionEntry[] = []
): CompositionEntry[] {
  const entries: CompositionEntry[] = [];

  // Aluminium is held in `elementValues` like every other element - whether it
  // was auto-filled or typed by hand is a UI concern, not a storage one.
  for (const element of LM6_ELEMENTS) {
    const value = (elementValues[element.symbol] ?? "").trim();
    if (value) entries.push({ key: element.symbol, value: `${value}%` });
  }

  return [...entries, ...custom];
}
