/**
 * Page-signature stability: two snapshots of the "same" page that differ ONLY in
 * dynamic ids / hashed classes / per-item content must hash to the SAME signature
 * (so the cache hits across loads); structurally different pages must differ.
 *
 * Pure unit test on the skeleton derivation — no browser needed.
 */
import { describe, expect, it } from "vitest";
import { stableSkeleton, pageSignature, type SkeletonElement } from "../src/resolver/cache.js";

const el = (e: SkeletonElement) => e;

describe("stable page signature", () => {
  it("same page differing ONLY in a dynamic (uuid) id -> same signature", () => {
    const a = [el({ tag: "button", role: "button", name: "Button with Dynamic ID", attributes: { id: "ef69ddd3-7be4-7ebe-ff00-e59d8c65dc4f" } })];
    const b = [el({ tag: "button", role: "button", name: "Button with Dynamic ID", attributes: { id: "c245b28c-6dcf-6a32-7b0e-94f51dbec605" } })];
    expect(stableSkeleton(a)).toBe(stableSkeleton(b));
    expect(pageSignature("http://x/p", stableSkeleton(a))).toBe(pageSignature("http://x/p", stableSkeleton(b)));
  });

  it("hashed / churning class names do not affect the signature", () => {
    const a = [el({ tag: "div", role: "button", name: "Save", attributes: { class: "btn-a1b2c3d4" } })];
    const b = [el({ tag: "div", role: "button", name: "Save", attributes: { class: "btn-z9y8x7w6" } })];
    expect(stableSkeleton(a)).toBe(stableSkeleton(b));
  });

  it("Hacker-News-shaped page is stable across content churn (per-story vote ids + titles)", () => {
    const nav = (): SkeletonElement[] => [
      el({ tag: "a", role: "link", name: "Hacker News", attributes: { id: "hnmain-logo" } }),
      el({ tag: "a", role: "link", name: "new" }),
      el({ tag: "a", role: "link", name: "past" }),
      el({ tag: "input", role: "textbox", name: "Search", attributes: { type: "text" } }),
    ];
    const page = (n: number, seed: string): SkeletonElement[] => {
      const out = nav();
      for (let i = 0; i < n; i++) {
        out.push(el({ tag: "a", role: "link", name: `${seed} a fairly long story headline number ${i} here`, attributes: { href: `https://ext.example/${i}` } }));
        out.push(el({ tag: "a", role: "link", attributes: { id: `up_${40000000 + i}`, href: `vote?id=${i}` } })); // bare vote arrow
      }
      return out;
    };
    // 30 stories one minute, 25 different stories the next -> identical signature
    // (the chrome is stable; per-story links/vote-ids are noise and drop out).
    expect(stableSkeleton(page(30, "alpha"))).toBe(stableSkeleton(page(25, "beta")));
    expect(stableSkeleton(page(30, "alpha")).length).toBeGreaterThan(0); // not degenerate
  });

  it("a numbered list collapses (30 items ≡ 25 items) — repeated siblings don't inflate it", () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => el({ tag: "li", role: "listitem", name: `Item ${i}` }));
    expect(stableSkeleton(list(30))).toBe(stableSkeleton(list(25)));
  });

  it("structurally DIFFERENT pages produce DIFFERENT signatures", () => {
    const login = [
      el({ tag: "input", role: "textbox", name: "Email", attributes: { type: "email" } }),
      el({ tag: "input", role: "textbox", name: "Password", attributes: { type: "password" } }),
      el({ tag: "button", role: "button", name: "Log in" }),
    ];
    const search = [
      el({ tag: "input", role: "textbox", name: "Search", attributes: { type: "search" } }),
      el({ tag: "button", role: "button", name: "Go" }),
    ];
    expect(stableSkeleton(login)).not.toBe(stableSkeleton(search));
    expect(pageSignature("http://x/p", stableSkeleton(login))).not.toBe(
      pageSignature("http://x/p", stableSkeleton(search)),
    );
  });

  it("stable ids/testids still discriminate; URL keying still separates; query is ignored", () => {
    const withId = [el({ tag: "button", role: "button", name: "Go", attributes: { id: "login-button" } })];
    const noId = [el({ tag: "button", role: "button", name: "Go" })];
    expect(stableSkeleton(withId)).not.toBe(stableSkeleton(noId)); // a stable id matters

    const sk = stableSkeleton(noId);
    expect(pageSignature("http://x/a", sk)).not.toBe(pageSignature("http://x/b", sk)); // pathname scoping
    expect(pageSignature("http://x/a?q=1", sk)).toBe(pageSignature("http://x/a?q=2", sk)); // query stripped
  });
});
