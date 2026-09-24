import { describe, expect, it } from "bun:test";
import { parseAuthorLink, authorInfoFromElement } from "../src/lib/author-parser";

interface MockElementOptions {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: MockElementOptions[];
}

function createMockElement(options: MockElementOptions): any {
  const attrs = options.attrs ?? {};
  const children: any[] = [];

  const element: any = {
    tagName: options.tag.toUpperCase(),
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
    parentElement: null,
    children,
    get textContent(): string {
      let result = options.text ?? "";
      for (const child of children) {
        result += child.textContent;
      }
      return result;
    },
    querySelector(selector: string) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector: string): any[] {
      const matches: any[] = [];

      function check(node: any) {
        for (const child of node.children) {
          if (selectorMatches(child, selector)) {
            matches.push(child);
          }
          check(child);
        }
      }

      check(this);
      return matches;
    },
  };

  if (options.children) {
    for (const childOpt of options.children) {
      const child = createMockElement(childOpt);
      child.parentElement = element;
      children.push(child);
    }
  }

  return element;
}

function selectorMatches(el: any, selector: string): boolean {
  const parts = selector.split(",").map((s) => s.trim());
  for (const part of parts) {
    if (part === "img" && el.tagName === "IMG") return true;
    if (part.startsWith("a[") && el.tagName === "A") {
      const href = el.getAttribute("href") ?? "";
      if (part.includes('*="/@"') && href.includes("/@")) return true;
      if (part.includes('^="/@"') && href.startsWith("/@")) return true;
      if (part.includes('^="https://substack.com/@"') && href.startsWith("https://substack.com/@")) return true;
    }
  }
  return false;
}

describe("author-parser", () => {
  describe("parseAuthorLink", () => {
    it("extracts clean handle from Substack profile URLs", () => {
      expect(parseAuthorLink("https://substack.com/@griffingooch")).toBe("griffingooch");
      expect(parseAuthorLink("/@willparkeranderson")).toBe("willparkeranderson");
      expect(parseAuthorLink("https://writer.substack.com/@alice_smith")).toBe("alice_smith");
      expect(parseAuthorLink("@bob-jones")).toBe("bob-jones");
    });

    it("rejects non-author URLs and does not misparse https/home/notes as handles", () => {
      expect(parseAuthorLink("https://substack.com/home")).toBeNull();
      expect(parseAuthorLink("https://substack.com/notes")).toBeNull();
      expect(parseAuthorLink("/p/some-post-title")).toBeNull();
      expect(parseAuthorLink("")).toBeNull();
    });
  });

  describe("authorInfoFromElement", () => {
    it("correctly identifies the original author on a restacked note without cross-wiring", () => {
      // Simulates: Will Parker Anderson restacked Griffin Gooch's note
      const mockNote = createMockElement({
        tag: "div",
        attrs: { role: "article", "aria-label": "Note" },
        children: [
          // Restack banner
          {
            tag: "div",
            children: [
              {
                tag: "a",
                attrs: { href: "/@willparkeranderson" },
                text: "Will Parker Anderson",
              },
              {
                tag: "span",
                text: " restacked",
              },
            ],
          },
          // Author row
          {
            tag: "div",
            children: [
              {
                tag: "div",
                children: [
                  {
                    tag: "a",
                    attrs: { href: "/@griffingooch" },
                    children: [
                      {
                        tag: "img",
                        attrs: { src: "https://avatar.url", alt: "Griffin Gooch" },
                      },
                    ],
                  },
                ],
              },
              {
                tag: "div",
                children: [
                  {
                    tag: "a",
                    attrs: { href: "/@griffingooch" },
                    text: "Griffin Gooch",
                  },
                ],
              },
              {
                tag: "div",
                children: [
                  {
                    tag: "button",
                    attrs: { "aria-label": "More options" },
                  },
                ],
              },
            ],
          },
        ],
      });

      const info = authorInfoFromElement(mockNote);
      expect(info).not.toBeNull();
      // MUST NOT have handle 'griffingooch' with name 'Will Parker Anderson'!
      expect(info?.handle).toBe("griffingooch");
      expect(info?.name).toBe("Griffin Gooch");
    });

    it("prefers the linked profile name when avatar alt describes another person", () => {
      const authorRow = createMockElement({
        tag: "div",
        children: [
          {
            tag: "a",
            attrs: { href: "/@griffingooch" },
            children: [{
              tag: "img",
              attrs: { src: "https://avatar.url", alt: "Will Parker Anderson" },
            }],
          },
          { tag: "a", attrs: { href: "/@griffingooch" }, text: "Griffin Gooch" },
        ],
      });

      const info = authorInfoFromElement(authorRow);
      expect(info?.handle).toBe("griffingooch");
      expect(info?.name).toBe("Griffin Gooch");
    });

    it("extracts author info when passed specifically the author row element", () => {
      const mockAuthorRow = createMockElement({
        tag: "div",
        children: [
          {
            tag: "a",
            attrs: { href: "/@griffingooch" },
            children: [
              {
                tag: "img",
                attrs: { src: "https://avatar.url", alt: "Griffin Gooch" },
              },
            ],
          },
          {
            tag: "a",
            attrs: { href: "/@griffingooch" },
            text: "Griffin Gooch",
          },
        ],
      });

      const info = authorInfoFromElement(mockAuthorRow);
      expect(info?.handle).toBe("griffingooch");
      expect(info?.name).toBe("Griffin Gooch");
    });
  });
});
