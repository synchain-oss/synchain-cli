import pc from "picocolors";
import { apiFetch, ApiError, formatApiError, resolveActiveProject, wantsJson } from "../api.js";
import { loadConfig } from "../config.js";
import { renderTable } from "../util/table.js";
import { isUuid, resolveByPrefix } from "../util/resolve-id.js";
import { sanitizeInline } from "../util/sanitize.js";

// Synchain schedule tags (see lib/calendar/schedule-api.ts eventInputSchema).
const TAGS = [
  "meeting",
  "mix",
  "master",
  "vocal",
  "review",
  "release",
  "arrange",
  "harmony",
  "custom",
] as const;
type Tag = (typeof TAGS)[number];

interface ScheduleEvent {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  tag: Tag;
  customTag: string | null;
  color: string | null;
  createdBy: string;
  createdAt: string;
  creatorName: string | null;
}

interface ScheduleListResponse {
  events: ScheduleEvent[];
  isAdmin: boolean;
}

interface ScheduleEventResponse {
  event: ScheduleEvent;
}

export interface CalendarFlags {
  title?: string;
  start?: string;
  end?: string;
  desc?: string;
  tag?: string;
  customTag?: string;
  from?: string;
  to?: string;
  project?: string;
  json?: boolean;
}

/**
 * Parses a date in ISO 8601 (with timezone) or local `YYYY-MM-DD HH:mm` form and
 * returns an ISO 8601 (UTC) string. Throws on unparseable input. Exported for tests.
 */
export function parseDateInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Empty date value");

  // Local form: YYYY-MM-DD HH:mm (no timezone). Detect first so we don't hit the
  // UTC-treating "YYYY-MM-DDTHH:mm" parse some runtimes do.
  const localMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (localMatch) {
    const [, y, mo, d, h, mi, s] = localMatch;
    const dt = new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      s ? Number(s) : 0
    );
    if (Number.isNaN(dt.getTime())) throw new Error(`Invalid date: ${input}`);
    return dt.toISOString();
  }

  const dt = new Date(trimmed);
  if (Number.isNaN(dt.getTime())) {
    throw new Error(
      `Unrecognized date: ${input}. Use ISO 8601 (2026-06-01T10:00:00Z) or local "YYYY-MM-DD HH:mm".`
    );
  }
  return dt.toISOString();
}

function formatLocal(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function validateTag(t: string | undefined, fallback: Tag = "meeting"): Tag {
  if (!t) return fallback;
  if ((TAGS as readonly string[]).includes(t)) return t as Tag;
  throw new Error(`Invalid --tag "${t}". Must be one of: ${TAGS.join(", ")}.`);
}

/** Label a builtin tag or the free-text custom tag. */
function tagLabel(e: { tag: Tag; customTag: string | null }): string {
  return e.tag === "custom" ? (e.customTag ?? "custom") : e.tag;
}

export async function runCalendarAdd(flags: CalendarFlags): Promise<void> {
  const cfg = await loadConfig();
  try {
    if (!flags.title || !flags.title.trim()) {
      console.error(pc.red("--title is required."));
      process.exit(1);
    }
    if (!flags.start) {
      console.error(pc.red("--start is required."));
      process.exit(1);
    }
    if (!flags.end) {
      console.error(pc.red("--end is required."));
      process.exit(1);
    }
    const projectId = resolveActiveProject(cfg, flags.project);
    const tag = validateTag(flags.tag);
    if (tag === "custom" && !flags.customTag?.trim()) {
      console.error(pc.red("--custom-tag is required when --tag is custom."));
      process.exit(1);
    }

    const startTime = parseDateInput(flags.start!);
    const endTime = parseDateInput(flags.end!);
    if (new Date(endTime) <= new Date(startTime)) {
      console.error(pc.red("End time must be after start time."));
      process.exit(1);
    }

    const body: Record<string, unknown> = { title: flags.title!.trim(), startTime, endTime, tag };
    if (flags.desc !== undefined) body.description = flags.desc;
    if (tag === "custom") body.customTag = flags.customTag!.trim();

    const result = await apiFetch<ScheduleEventResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/schedule`,
      { method: "POST", body }
    );

    if (wantsJson(flags)) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(
        pc.green(
          `Created event ${result.event.id.slice(0, 8)} (${formatLocal(result.event.startTime)} → ${formatLocal(result.event.endTime)})`
        )
      );
    }
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exit(1);
  }
}

export async function runCalendarLs(flags: CalendarFlags): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);

    // Default window: next 30 days.
    const now = new Date();
    const fromIso = flags.from ? parseDateInput(flags.from) : now.toISOString();
    const toIso = flags.to
      ? parseDateInput(flags.to)
      : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const qs = new URLSearchParams({ startDate: fromIso, endDate: toIso });
    const result = await apiFetch<ScheduleListResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/schedule?${qs.toString()}`
    );

    if (wantsJson(flags)) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (!result.events || result.events.length === 0) {
      console.log(pc.dim("(no events in range)"));
      return;
    }
    const rows = result.events.map((e) => ({
      id: e.id.slice(0, 8),
      title: e.title,
      tag: tagLabel(e),
      start: formatLocal(e.startTime),
      end: formatLocal(e.endTime),
      creator: e.creatorName ?? "",
    }));
    console.log(
      renderTable(
        [
          { header: "id", key: "id" },
          { header: "title", key: "title" },
          { header: "tag", key: "tag" },
          { header: "start", key: "start" },
          { header: "end", key: "end" },
          { header: "creator", key: "creator" },
        ],
        rows
      )
    );
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exit(1);
  }
}

/** Fetch events in a wide window (±1 year) for id-prefix resolution. */
async function fetchAllEventsForResolve(projectId: string): Promise<ScheduleEvent[]> {
  const now = Date.now();
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  const params = new URLSearchParams({
    startDate: new Date(now - oneYearMs).toISOString(),
    endDate: new Date(now + oneYearMs).toISOString(),
  });
  const res = await apiFetch<ScheduleListResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/schedule?${params.toString()}`
  );
  return res.events;
}

export async function runCalendarEdit(eventId: string, flags: CalendarFlags): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);
    // #200 item9: edit always needs the full event record (the PATCH re-validates
    // the whole body, so we merge changes onto the current values), and schedule
    // exposes no single-event GET — a full UUID can't short-circuit the window
    // fetch here. rm, which needs only the id, does short-circuit (see runCalendarRm).
    const event = await resolveByPrefix(
      eventId,
      () => fetchAllEventsForResolve(projectId),
      "event"
    );

    if (
      flags.title === undefined &&
      flags.desc === undefined &&
      flags.tag === undefined &&
      flags.customTag === undefined &&
      flags.start === undefined &&
      flags.end === undefined
    ) {
      console.error(
        pc.red(
          "Nothing to update — pass at least one of --title, --start, --end, --desc, --tag, --custom-tag."
        )
      );
      process.exit(1);
    }

    // Synchain's PATCH validates the FULL event body, so merge changes onto the
    // existing event rather than sending a partial patch.
    const tag = flags.tag !== undefined ? validateTag(flags.tag, event.tag) : event.tag;
    const startTime = flags.start !== undefined ? parseDateInput(flags.start) : event.startTime;
    const endTime = flags.end !== undefined ? parseDateInput(flags.end) : event.endTime;
    if (new Date(endTime) <= new Date(startTime)) {
      console.error(pc.red("End time must be after start time."));
      process.exit(1);
    }
    const customTag =
      flags.customTag !== undefined ? flags.customTag.trim() : (event.customTag ?? undefined);
    if (tag === "custom" && !customTag) {
      console.error(pc.red("--custom-tag is required when the tag is custom."));
      process.exit(1);
    }
    // Guard the inverse: --custom-tag on a non-custom event would be silently dropped
    // from the PATCH body below yet still print "Updated" — a false success. Fail loudly.
    if (flags.customTag !== undefined && tag !== "custom") {
      console.error(
        pc.red(
          `--custom-tag only applies to custom-tagged events (this event's tag is "${sanitizeInline(tag)}"). ` +
            "Pass --tag custom together with --custom-tag."
        )
      );
      process.exit(1);
    }

    const body: Record<string, unknown> = {
      title: flags.title !== undefined ? flags.title : event.title,
      startTime,
      endTime,
      tag,
    };
    const description = flags.desc !== undefined ? flags.desc : event.description;
    if (description !== null && description !== undefined) body.description = description;
    if (tag === "custom") body.customTag = customTag;

    const result = await apiFetch<ScheduleEventResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/schedule/${encodeURIComponent(event.id)}`,
      { method: "PATCH", body }
    );

    if (wantsJson(flags)) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(pc.green(`Updated event ${result.event.id.slice(0, 8)}.`));
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      console.error(pc.red("Only the creator or a project admin can edit this event."));
      process.exit(1);
      return;
    }
    if (err instanceof Error && /No event matches|prefix.*ambiguous/.test(err.message)) {
      console.error(pc.red(err.message));
      process.exit(1);
      return;
    }
    console.error(pc.red(formatApiError(err)));
    process.exit(1);
  }
}

export async function runCalendarRm(eventId: string, flags: CalendarFlags): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);
    // #200 item9: a full UUID is DELETE-able directly — only an 8-char prefix
    // needs the ±1yr window fetch (schedule has no single-event GET to resolve
    // against, so a prefix still has to be matched client-side).
    const resolvedId = isUuid(eventId)
      ? eventId
      : (await resolveByPrefix(eventId, () => fetchAllEventsForResolve(projectId), "event")).id;
    await apiFetch(
      `/api/projects/${encodeURIComponent(projectId)}/schedule/${encodeURIComponent(resolvedId)}`,
      { method: "DELETE" }
    );
    console.log(pc.green(`Deleted event ${resolvedId.slice(0, 8)}.`));
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      console.error(pc.red("Only the creator or a project admin can delete this event."));
      process.exit(1);
      return;
    }
    // The full-UUID short-circuit hits DELETE without resolving first, so a missing
    // event surfaces as the endpoint's 404 rather than resolveByPrefix's "No event
    // matches". Map it to the same friendly message the prefix path prints.
    if (err instanceof ApiError && err.status === 404) {
      console.error(pc.red(`No event matches "${eventId}".`));
      process.exit(1);
      return;
    }
    if (err instanceof Error && /No event matches|prefix.*ambiguous/.test(err.message)) {
      console.error(pc.red(err.message));
      process.exit(1);
      return;
    }
    console.error(pc.red(formatApiError(err)));
    process.exit(1);
  }
}

export const CALENDAR_HELP = {
  name: "calendar",
  summary: "Create, list, edit, and remove calendar events.",
  body: [
    "Usage:",
    "  synchain calendar add --title <t> --start <date> --end <date>",
    "                        [--desc <d>] [--tag <tag>] [--custom-tag <c>]",
    "                        [--project <p>] [--json]",
    "  synchain calendar ls [--from <date>] [--to <date>] [--project <p>] [--json]",
    "  synchain calendar edit <eventId> [--title] [--start] [--end] [--desc] [--tag]",
    "                                    [--custom-tag] [--project <p>] [--json]",
    "  synchain calendar rm <eventId> [--project <p>]",
    "",
    "Tags: meeting, mix, master, vocal, review, release, arrange, harmony, custom.",
    "Use --custom-tag with `--tag custom` for a free-text label.",
    "",
    "Date input accepts ISO 8601 (2026-06-01T10:00:00Z) or local `YYYY-MM-DD HH:mm`",
    "(parsed in your machine's timezone). `ls` defaults to the next 30 days.",
    "",
    "Only the event creator or a project admin may edit or remove an event.",
  ].join("\n"),
};
