// Pure, IO-free logic for the Bulk Review Grid (Task 9). Everything here is a
// deterministic function of its inputs so it can be unit-tested without a live
// Supabase connection or a DOM. The grid component wires these to URL search
// params + fetched pages; the data layer owns the actual queries.

// The light row shape the grid renders — no full `body`, just a preview. Kept
// structural (not imported from the db layer) so this module has zero IO deps.
export type GridVariantRow = {
  persona_id: string;
  persona_name: string;
  avatar_color: string;
  platform: string;
  post_variant_id: string;
  status: string;
  body_preview: string;
};

export type GridFilters = {
  status?: string;
  platform?: string;
  persona_id?: string;
};

// Sort keys the grid exposes. `persona` groups accounts together (by name then
// platform); `status` and `platform` sort by that field. Direction is applied
// on top.
export type GridSortKey = "persona" | "status" | "platform";
export type GridSortDir = "asc" | "desc";
export type GridSort = { key: GridSortKey; dir: GridSortDir };

export const DEFAULT_SORT: GridSort = { key: "persona", dir: "asc" };

// Statuses that count as "approved" for the progress meter. Approval routes a
// variant through the worker chokepoint, which assigns scheduled_at and moves
// it out of the pending/draft stage — so anything scheduled or already live
// counts as approved.
const APPROVED_STATUSES = new Set([
  "approved",
  "scheduled",
  "publishing",
  "published",
]);

export function isApprovedStatus(status: string): boolean {
  return APPROVED_STATUSES.has(status);
}

// ── Filtering ────────────────────────────────────────────────────────────────

export function filterVariants(
  rows: readonly GridVariantRow[],
  filters: GridFilters = {}
): GridVariantRow[] {
  return rows.filter((r) => {
    if (filters.status && r.status !== filters.status) return false;
    if (filters.platform && r.platform !== filters.platform) return false;
    if (filters.persona_id && r.persona_id !== filters.persona_id) return false;
    return true;
  });
}

// ── Sorting ──────────────────────────────────────────────────────────────────

function compareByKey(
  a: GridVariantRow,
  b: GridVariantRow,
  key: GridSortKey
): number {
  switch (key) {
    case "persona": {
      // Group by account: name, then platform, so an account's variants stay
      // adjacent regardless of platform ordering.
      const byName = a.persona_name.localeCompare(b.persona_name);
      if (byName !== 0) return byName;
      return a.platform.localeCompare(b.platform);
    }
    case "status":
      return a.status.localeCompare(b.status);
    case "platform":
      return a.platform.localeCompare(b.platform);
  }
}

export function sortVariants(
  rows: readonly GridVariantRow[],
  sort: GridSort = DEFAULT_SORT
): GridVariantRow[] {
  const dir = sort.dir === "desc" ? -1 : 1;
  // Stable tiebreak on post_variant_id so equal keys keep a deterministic order.
  return [...rows].sort((a, b) => {
    const primary = compareByKey(a, b, sort.key);
    if (primary !== 0) return primary * dir;
    return a.post_variant_id.localeCompare(b.post_variant_id);
  });
}

// Filter then sort → the ordered subset the grid renders for a page.
export function orderedVariants(
  rows: readonly GridVariantRow[],
  opts: { filters?: GridFilters; sort?: GridSort } = {}
): GridVariantRow[] {
  return sortVariants(filterVariants(rows, opts.filters), opts.sort);
}

// ── Selection reducer ────────────────────────────────────────────────────────
// Selection is a plain set of post_variant_ids. Actions cover the four gestures
// the grid needs: toggle a single row, select every row on the current page,
// select every row matching the active filters (ids supplied by the caller,
// since matching rows may span pages), and clear.

export type SelectionState = { ids: ReadonlySet<string> };

export type SelectionAction =
  | { type: "toggle"; id: string }
  | { type: "select-page"; ids: readonly string[] }
  | { type: "select-all-matching"; ids: readonly string[] }
  | { type: "clear" };

export const emptySelection: SelectionState = { ids: new Set() };

export function selectionReducer(
  state: SelectionState,
  action: SelectionAction
): SelectionState {
  switch (action.type) {
    case "toggle": {
      const next = new Set(state.ids);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ids: next };
    }
    case "select-page": {
      const next = new Set(state.ids);
      for (const id of action.ids) next.add(id);
      return { ids: next };
    }
    case "select-all-matching":
      return { ids: new Set(action.ids) };
    case "clear":
      return emptySelection;
  }
}

// True when every id in `pageIds` is currently selected (drives the page
// "select all" checkbox's checked/indeterminate state).
export function isPageFullySelected(
  state: SelectionState,
  pageIds: readonly string[]
): boolean {
  return pageIds.length > 0 && pageIds.every((id) => state.ids.has(id));
}

export function selectedCount(state: SelectionState): number {
  return state.ids.size;
}

// ── Progress ─────────────────────────────────────────────────────────────────

export type Progress = { approved: number; total: number; pct: number };

// Progress from explicit counts (the header read returns these without loading
// bodies).
export function progressFromCounts(approved: number, total: number): Progress {
  const pct = total > 0 ? Math.round((approved / total) * 100) : 0;
  return { approved, total, pct };
}

// Progress derived from a set of rows (used in tests / client-side rechecks).
export function progressFromRows(rows: readonly GridVariantRow[]): Progress {
  const approved = rows.reduce(
    (n, r) => (isApprovedStatus(r.status) ? n + 1 : n),
    0
  );
  return progressFromCounts(approved, rows.length);
}
