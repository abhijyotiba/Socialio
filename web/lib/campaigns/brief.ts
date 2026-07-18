import { SUPPORTED_PLATFORMS, type Platform } from "@/lib/constants/platforms";

// PURE module — no React, no IO. Builds the POST body for the worker's
// `POST /campaigns` contract from the Brief Composer form fields. The route
// (web/app/api/campaigns/route.ts) forwards this JSON body wholesale, and the
// worker re-validates with Pydantic.
//
// The worker requires an `ingestion_job_id` (a completed ingestion job). That
// id comes from an async ingest call, so it is NOT built here — the form
// creates the job and merges the id in at submit time. Everything else in the
// body is derived deterministically from the form state by buildCampaignPayload.

// Media assets are capped at 4 by the worker contract.
const MEDIA_ASSET_CAP = 4;

export type BriefFields = {
  goal?: string;
  coreMessage?: string;
  tone?: string;
  cta?: string;
  // "do" / "don't" bullet lists as entered in the form.
  dos?: string[];
  donts?: string[];
  mediaAssetIds?: string[];
  userAngle?: string;
  // Already-ISO timestamp strings (the form converts datetime-local → ISO).
  windowStart?: string;
  windowEnd?: string;
};

// A group's persona membership. Only the groups the user selected ("all in
// group") are passed in — each carries its member persona ids.
export type SelectedGroup = { id: string; persona_ids: string[] };

// Persona selection input. Individually-picked persona ids plus any selected
// groups (expanded to their members). `allPersonaIds` is the ordered full
// persona list, used only for the empty fallback (first persona).
export type PersonaSelection = {
  selectedPersonaIds: string[];
  selectedGroups: SelectedGroup[];
  allPersonaIds: string[];
};

// Platform selection input: the platforms the user toggled on, plus the set of
// platforms actually connected in the workspace. The result is filtered to
// connected ∩ SUPPORTED_PLATFORMS (and, of those, the ones the user selected).
export type PlatformSelection = {
  selected: string[];
  connected: string[];
};

export type CampaignBrief = {
  goal?: string;
  core_message?: string;
  tone?: string;
  cta?: string;
  // NOTE: the worker keys are exactly `do` / `dont` (not dos/donts).
  do?: string[];
  dont?: string[];
  media_asset_ids?: string[];
};

export type CampaignPayload = {
  persona_ids: string[];
  platforms?: Platform[];
  user_angle?: string;
  brief?: CampaignBrief;
  window_start?: string;
  window_end?: string;
};

// Trim a string and return undefined when it is empty — so empty optionals are
// omitted rather than sent as "".
function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// Trim each entry, drop blanks, and return undefined for an empty list — so
// empty optional arrays are omitted rather than sent as [].
function cleanList(values: string[] | undefined): string[] | undefined {
  const cleaned = (values ?? []).map((v) => v.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

// Resolve the persona selection to a deduped union of individually-selected
// persona ids and the members of any selected groups. Falls back to the first
// available persona when the resolved set is empty.
function resolvePersonaIds(personas: PersonaSelection): string[] {
  const union = new Set<string>();
  for (const id of personas.selectedPersonaIds) union.add(id);
  for (const group of personas.selectedGroups) {
    for (const id of group.persona_ids) union.add(id);
  }
  if (union.size > 0) return [...union];
  const first = personas.allPersonaIds[0];
  return first ? [first] : [];
}

// Filter the selected platforms down to connected ∩ SUPPORTED_PLATFORMS,
// preserving SUPPORTED_PLATFORMS order for determinism.
function resolvePlatforms(platforms: PlatformSelection): Platform[] {
  const selected = new Set(platforms.selected);
  const connected = new Set(platforms.connected);
  return SUPPORTED_PLATFORMS.filter(
    (p) => selected.has(p) && connected.has(p)
  );
}

// Build the brief sub-object, omitting empty keys. Returns undefined when
// nothing is set so the `brief` key is omitted entirely.
function buildBrief(fields: BriefFields): CampaignBrief | undefined {
  const brief: CampaignBrief = {};
  const goal = cleanString(fields.goal);
  const coreMessage = cleanString(fields.coreMessage);
  const tone = cleanString(fields.tone);
  const cta = cleanString(fields.cta);
  const dos = cleanList(fields.dos);
  const donts = cleanList(fields.donts);
  const media = cleanList(fields.mediaAssetIds)?.slice(0, MEDIA_ASSET_CAP);

  if (goal) brief.goal = goal;
  if (coreMessage) brief.core_message = coreMessage;
  if (tone) brief.tone = tone;
  if (cta) brief.cta = cta;
  if (dos) brief.do = dos;
  if (donts) brief.dont = donts;
  if (media) brief.media_asset_ids = media;

  return Object.keys(brief).length > 0 ? brief : undefined;
}

export function buildCampaignPayload(
  fields: BriefFields,
  personas: PersonaSelection,
  platforms: PlatformSelection
): CampaignPayload {
  const payload: CampaignPayload = {
    persona_ids: resolvePersonaIds(personas),
  };

  const resolvedPlatforms = resolvePlatforms(platforms);
  if (resolvedPlatforms.length > 0) payload.platforms = resolvedPlatforms;

  const userAngle = cleanString(fields.userAngle);
  if (userAngle) payload.user_angle = userAngle;

  const brief = buildBrief(fields);
  if (brief) payload.brief = brief;

  const windowStart = cleanString(fields.windowStart);
  const windowEnd = cleanString(fields.windowEnd);
  if (windowStart) payload.window_start = windowStart;
  if (windowEnd) payload.window_end = windowEnd;

  return payload;
}
