/**
 * Unit tests for wikiExportRoute helper functions.
 *
 * Tests cover:
 * - sanitizeFilename: safe filename generation
 * - buildNodePaths: hierarchical folder path construction from wiki tree
 * - Filename deduplication logic
 */

import { describe, expect, it } from "vitest";
import { sanitizeFilename, buildNodePaths } from "./wikiExportRoute";

// ─── sanitizeFilename ─────────────────────────────────────────────────────────
describe("sanitizeFilename", () => {
  it("replaces forbidden characters with underscores", () => {
    expect(sanitizeFilename('file<>:"/\\|?*name')).toMatch(/^file_+name$/);
  });

  it("replaces whitespace with underscores", () => {
    expect(sanitizeFilename("my document title")).toBe("my_document_title");
  });

  it("collapses multiple spaces into single underscore", () => {
    expect(sanitizeFilename("my   doc")).toBe("my_doc");
  });

  it("truncates to 80 characters", () => {
    const longTitle = "a".repeat(150);
    expect(sanitizeFilename(longTitle)).toHaveLength(80);
  });

  it("returns Untitled for empty string", () => {
    expect(sanitizeFilename("")).toBe("Untitled");
  });

  it("preserves normal alphanumeric characters", () => {
    expect(sanitizeFilename("MyDocument2024")).toBe("MyDocument2024");
  });

  it("handles unicode characters (Vietnamese)", () => {
    const result = sanitizeFilename("Tài liệu kỹ thuật");
    expect(result).toBe("Tài_liệu_kỹ_thuật");
  });

  it("replaces control characters", () => {
    const withControl = "file\x00name\x1fname";
    expect(sanitizeFilename(withControl)).toBe("file_name_name");
  });

  it("removes leading dots", () => {
    // ...hidden → replace leading dots → ___hidden → collapse underscores → _hidden
    expect(sanitizeFilename("...hidden")).toBe("_hidden");
  });

  it("collapses consecutive underscores", () => {
    expect(sanitizeFilename("a  b  c")).toBe("a_b_c");
  });
});

// ─── buildNodePaths ───────────────────────────────────────────────────────────
describe("buildNodePaths", () => {
  it("places root nodes (no parent) at top level", () => {
    const nodes = [
      { nodeToken: "root1", parentNodeToken: null, title: "Chapter 1", objType: "wiki" },
    ];
    const paths = buildNodePaths(nodes);
    expect(paths.get("root1")).toBe("Chapter_1");
  });

  it("builds 2-level hierarchy", () => {
    const nodes = [
      { nodeToken: "root1", parentNodeToken: null, title: "Chapter 1", objType: "wiki" },
      { nodeToken: "child1", parentNodeToken: "root1", title: "Section 1.1", objType: "docx" },
    ];
    const paths = buildNodePaths(nodes);
    expect(paths.get("root1")).toBe("Chapter_1");
    expect(paths.get("child1")).toBe("Chapter_1/Section_1.1");
  });

  it("builds 3-level hierarchy", () => {
    const nodes = [
      { nodeToken: "root1", parentNodeToken: null, title: "Chapter 1", objType: "wiki" },
      { nodeToken: "child1", parentNodeToken: "root1", title: "Section 1.1", objType: "wiki" },
      { nodeToken: "grandchild1", parentNodeToken: "child1", title: "Page 1.1.1", objType: "docx" },
    ];
    const paths = buildNodePaths(nodes);
    expect(paths.get("grandchild1")).toBe("Chapter_1/Section_1.1/Page_1.1.1");
  });

  it("handles multiple root nodes", () => {
    const nodes = [
      { nodeToken: "root1", parentNodeToken: null, title: "Chapter 1", objType: "wiki" },
      { nodeToken: "root2", parentNodeToken: null, title: "Chapter 2", objType: "wiki" },
      { nodeToken: "child1", parentNodeToken: "root1", title: "Section 1.1", objType: "docx" },
      { nodeToken: "child2", parentNodeToken: "root2", title: "Section 2.1", objType: "docx" },
    ];
    const paths = buildNodePaths(nodes);
    expect(paths.get("child1")).toBe("Chapter_1/Section_1.1");
    expect(paths.get("child2")).toBe("Chapter_2/Section_2.1");
  });

  it("falls back to top level when parent not in session", () => {
    const nodes = [
      // parentNodeToken points to a node NOT in the list (cross-space shortcut, etc.)
      { nodeToken: "orphan1", parentNodeToken: "unknown_parent", title: "Orphan Page", objType: "docx" },
    ];
    const paths = buildNodePaths(nodes);
    expect(paths.get("orphan1")).toBe("Orphan_Page");
  });

  it("sanitizes titles in paths", () => {
    const nodes = [
      { nodeToken: "root1", parentNodeToken: null, title: "Chapter: One", objType: "wiki" },
      { nodeToken: "child1", parentNodeToken: "root1", title: "Page/Sub", objType: "docx" },
    ];
    const paths = buildNodePaths(nodes);
    // ":" is replaced by "_", then consecutive underscores collapsed → "Chapter_One"
    expect(paths.get("child1")).toBe("Chapter_One/Page_Sub");
  });

  it("handles null/undefined titles gracefully", () => {
    const nodes = [
      { nodeToken: "root1", parentNodeToken: null, title: null, objType: "wiki" },
      { nodeToken: "child1", parentNodeToken: "root1", title: undefined, objType: "docx" },
    ];
    const paths = buildNodePaths(nodes);
    expect(paths.get("root1")).toBe("Untitled");
    expect(paths.get("child1")).toBe("Untitled/Untitled");
  });

  it("does not crash on cycle (cycle guard)", () => {
    // A → B → A (cycle)
    const nodes = [
      { nodeToken: "A", parentNodeToken: "B", title: "Node A", objType: "docx" },
      { nodeToken: "B", parentNodeToken: "A", title: "Node B", objType: "docx" },
    ];
    // Should not throw or infinite loop
    expect(() => buildNodePaths(nodes)).not.toThrow();
  });

  it("returns correct count of paths", () => {
    const nodes = [
      { nodeToken: "r1", parentNodeToken: null, title: "Root", objType: "wiki" },
      { nodeToken: "c1", parentNodeToken: "r1", title: "Child1", objType: "docx" },
      { nodeToken: "c2", parentNodeToken: "r1", title: "Child2", objType: "docx" },
    ];
    const paths = buildNodePaths(nodes);
    expect(paths.size).toBe(3);
  });

  it("handles empty node list", () => {
    const paths = buildNodePaths([]);
    expect(paths.size).toBe(0);
  });
});

// ─── Filename deduplication (path-level) ─────────────────────────────────────
describe("Path deduplication", () => {
  it("generates unique paths for duplicate folder paths", () => {
    const usedPaths = new Map<string, number>();
    const results: string[] = [];

    const addFile = (folderPath: string) => {
      const count = usedPaths.get(folderPath) ?? 0;
      usedPaths.set(folderPath, count + 1);
      const uniquePath = count === 0 ? `${folderPath}.md` : `${folderPath}_${count}.md`;
      results.push(uniquePath);
    };

    addFile("Chapter_1/Introduction");
    addFile("Chapter_1/Introduction");
    addFile("Chapter_1/Introduction");
    addFile("Chapter_1/Unique_Page");

    expect(results[0]).toBe("Chapter_1/Introduction.md");
    expect(results[1]).toBe("Chapter_1/Introduction_1.md");
    expect(results[2]).toBe("Chapter_1/Introduction_2.md");
    expect(results[3]).toBe("Chapter_1/Unique_Page.md");
  });
});
