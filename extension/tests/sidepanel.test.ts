import { describe, expect, test } from "bun:test";
import { describeAction } from "../src/sidepanel/ui";
import { noteDoc } from "../src/sidepanel/views";

describe("side panel helpers", () => {
  test("turns Note text into one paragraph per line", () => {
    expect(noteDoc("First line\n\nThird")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First line" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "Third" }] },
      ],
    });
  });

  test("describes activity from either side", () => {
    expect(describeAction("reply", "inbound", "note")).toBe("Replied to your Note");
    expect(describeAction("restack", "outbound", "post")).toBe("You restacked their post");
    expect(describeAction("like", "inbound", null)).toBe("Liked");
    expect(describeAction("unknown", "outbound", null)).toBe("You interacted");
  });
});
