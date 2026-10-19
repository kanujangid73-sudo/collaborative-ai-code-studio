import { describe, expect, it } from "vitest";
import { avatarHue, formatUptime, initials, mergeMessages, modelLabel } from "./format.js";

describe("formatUptime", () => {
  it("handles missing values", () => expect(formatUptime(null)).toBe("—"));
  it("formats seconds", () => expect(formatUptime(42)).toBe("42s"));
  it("formats minutes", () => expect(formatUptime(125)).toBe("2m 5s"));
  it("formats hours", () => expect(formatUptime(3 * 3600 + 120)).toBe("3h 2m"));
  it("formats days", () => expect(formatUptime(2 * 86400 + 3600)).toBe("2d 1h"));
});

describe("initials", () => {
  it("uses two words when present", () => expect(initials("jane_doe")).toBe("JD"));
  it("falls back to the first two letters", () => expect(initials("alice")).toBe("AL"));
});

describe("avatarHue", () => {
  it("is stable and in range", () => {
    expect(avatarHue("bob")).toBe(avatarHue("bob"));
    expect(avatarHue("bob")).toBeGreaterThanOrEqual(0);
    expect(avatarHue("bob")).toBeLessThan(360);
  });
});

describe("mergeMessages", () => {
  it("dedupes by id and sorts", () => {
    const merged = mergeMessages([{ id: 3 }, { id: 1 }], [{ id: 2 }, { id: 3, edited: true }]);
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(merged[2].edited).toBe(true);
  });
});

describe("modelLabel", () => {
  it("formats Claude model ids", () => expect(modelLabel("claude-opus-5-5")).toBe("Claude Opus 5.5"));
  it("formats the offline assistant", () => expect(modelLabel("offline-assistant")).toBe("Offline assistant"));
  it("marks Ollama models as local", () => expect(modelLabel("qwen2.5-coder:1.5b")).toBe("qwen2.5-coder:1.5b · local"));
});
