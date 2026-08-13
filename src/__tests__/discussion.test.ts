// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  buildListQuery,
  paginationFooter,
  renderThread,
  threadTableRows,
  type DiscussionPost,
  type PagedDiscussionPost,
} from "../commands/discussion.js";

function post(p: Partial<DiscussionPost> & { id: string }): DiscussionPost {
  return {
    projectId: "proj",
    userId: "u",
    parentId: null,
    title: "",
    content: "",
    category: "general",
    pinned: false,
    threadState: "open",
    isEdited: false,
    isAiGenerated: false,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    authorName: "Alice",
    ...p,
  };
}

function pagedPost(p: Partial<PagedDiscussionPost> & { id: string }): PagedDiscussionPost {
  return { ...post(p), replyCount: 0, ...p };
}

describe("renderThread", () => {
  it("renders the root, then nested replies with author names", () => {
    const root = post({
      id: "root",
      title: "Mixdown v2",
      content: "Take a listen",
      authorName: "Alice",
    });
    const reply = post({
      id: "reply-1",
      parentId: "root",
      content: "Bass is muddy",
      authorName: "Bob",
      createdAt: "2026-06-01T01:00:00.000Z",
    });
    const out = renderThread(root, [root, reply]);
    expect(out).toContain("Mixdown v2 — by Alice");
    expect(out).toContain("Take a listen");
    expect(out).toContain("by Bob");
    expect(out).toContain("Bass is muddy");
  });

  it("marks AI-generated replies with an [AI] tag", () => {
    const root = post({ id: "root", title: "Topic" });
    const aiReply = post({
      id: "ai",
      parentId: "root",
      authorName: "Agent",
      isAiGenerated: true,
      content: "Summary",
    });
    const out = renderThread(root, [root, aiReply]);
    expect(out).toContain("[AI]");
  });
});

describe("threadTableRows", () => {
  it("uses the server-supplied replyCount and shortens the id", () => {
    const rows = threadTableRows([
      pagedPost({ id: "abcdef0123456789", title: "Mixdown", replyCount: 4 }),
      pagedPost({ id: "zzzz", title: "Art", replyCount: 0, category: "art" }),
    ]);
    expect(rows[0]).toMatchObject({ id: "abcdef01", title: "Mixdown", replies: 4 });
    expect(rows[1]).toMatchObject({ id: "zzzz", replies: 0, category: "art" });
  });

  it("stamps [AI] for AI-generated threads and blank for human ones", () => {
    const rows = threadTableRows([
      pagedPost({ id: "a", isAiGenerated: true }),
      pagedPost({ id: "b", isAiGenerated: false }),
    ]);
    expect(rows[0].ai).toBe("[AI]");
    expect(rows[1].ai).toBe("");
  });
});

describe("paginationFooter", () => {
  it("returns null when a single page covers every thread", () => {
    expect(paginationFooter(0, 3, 3, 50)).toBeNull();
    expect(paginationFooter(0, 0, 0, 50)).toBeNull();
  });

  it("shows a next-page hint when more threads remain", () => {
    expect(paginationFooter(0, 50, 120, 50)).toBe(
      "Showing 1–50 of 120 threads · next page: --offset 50"
    );
  });

  it("shows the range without a next hint on the last page", () => {
    expect(paginationFooter(100, 20, 120, 50)).toBe("Showing 101–120 of 120 threads");
  });
});

describe("buildListQuery", () => {
  it("defaults to limit 50 / offset 0 so the server uses paginated mode", () => {
    expect(buildListQuery({})).toBe("limit=50&offset=0");
  });

  it("forwards the flag strings verbatim (server clamps/parses)", () => {
    expect(buildListQuery({ limit: "100", offset: "200" })).toBe("limit=100&offset=200");
  });
});
