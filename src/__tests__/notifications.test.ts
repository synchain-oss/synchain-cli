import { describe, expect, it } from "vitest";
import {
  formatNotificationLine,
  relativeTime,
  type NotificationItem,
} from "../commands/notifications.js";

const NOW = Date.parse("2026-06-01T12:00:00.000Z");

describe("relativeTime", () => {
  it("renders seconds/minutes/hours/days", () => {
    expect(relativeTime("2026-06-01T11:59:30.000Z", NOW)).toBe("30s ago");
    expect(relativeTime("2026-06-01T11:30:00.000Z", NOW)).toBe("30m ago");
    expect(relativeTime("2026-06-01T09:00:00.000Z", NOW)).toBe("3h ago");
    expect(relativeTime("2026-05-29T12:00:00.000Z", NOW)).toBe("3d ago");
  });
  it("falls back to the raw string for an unparseable date", () => {
    expect(relativeTime("nope", NOW)).toBe("nope");
  });
});

function item(p: Partial<NotificationItem> & { id: string }): NotificationItem {
  return {
    projectId: "proj",
    projectName: "Album X",
    type: "file_uploaded",
    referenceType: "file",
    referenceId: "ref",
    entityTitle: "mix_v2.wav",
    actorName: "Alice",
    isRead: false,
    createdAt: "2026-06-01T09:00:00.000Z",
    ...p,
  };
}

describe("formatNotificationLine", () => {
  it("includes the id, type, relative time, and composed message", () => {
    const line = formatNotificationLine(item({ id: "abc123-full-id" }), NOW);
    expect(line).toContain("abc123-full-id");
    expect(line).toContain("[file_uploaded]");
    expect(line).toContain("3h ago");
    expect(line).toContain("Album X · mix_v2.wav · Alice");
    expect(line.startsWith("•")).toBe(true); // unread marker
  });

  it("marks read items without the unread dot and omits empty parts", () => {
    const line = formatNotificationLine(
      item({ id: "n2", isRead: true, entityTitle: null, actorName: null }),
      NOW
    );
    expect(line.startsWith("•")).toBe(false);
    expect(line).toContain("Album X");
    expect(line).not.toContain(" · ");
  });
});
