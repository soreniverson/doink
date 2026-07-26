/**
 * observe() free path — a heuristic scan of interactive elements.
 * Maps the shared RawElement scan into the public Observation shape.
 */
import type { Page } from "playwright";
import { collectInteractive, type CollectOptions } from "../dom/interactive.js";
import type { Observation } from "../types.js";

export async function collectObservations(
  page: Page,
  opts: CollectOptions,
): Promise<Observation[]> {
  const raw = await collectInteractive(page, opts);
  return raw.map((e) => {
    const attributes: Record<string, string> = {};
    if (e.id) attributes.id = e.id;
    if (e.type) attributes.type = e.type;
    if (e.href) attributes.href = e.href;
    if (e.testid) attributes["data-testid"] = e.testid;
    if (e.placeholder) attributes.placeholder = e.placeholder;
    if (e.ariaLabel) attributes["aria-label"] = e.ariaLabel;

    const obs: Observation = {
      selector: e.selector,
      role: e.role,
      tag: e.tag,
      visible: e.visible,
    };
    if (e.text) obs.text = e.text;
    if (e.name) obs.name = e.name;
    if (Object.keys(attributes).length > 0) obs.attributes = attributes;
    return obs;
  });
}
