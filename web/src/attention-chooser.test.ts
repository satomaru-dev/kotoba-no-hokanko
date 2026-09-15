import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AttentionChooser } from "./AttentionChooser";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });
const click = async (text: string) => {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === text)!;
  await act(async () => button.click());
};
it("requires a purpose and retains input after a failed save, closing only on success", async () => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const close = vi.fn();
  await act(async () => root.render(createElement(AttentionChooser, { onSelect: save, onClose: close, purposes: ["旅行"] })));
  await click("〇〇に使うから取っておく");
  const confirm = [...host.querySelectorAll("button")].find(b => b.textContent === "この使い道で取っておく")!;
  expect(confirm.disabled).toBe(true);
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  旅行  ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(confirm.disabled).toBe(false);
  await click("この使い道で取っておく");
  expect(save).toHaveBeenCalledWith("keep_for_use", false, "旅行");
  expect(close).not.toHaveBeenCalled();
  expect(input.value).toBe("  旅行  ");
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await click("この使い道で取っておく");
  expect(close).toHaveBeenCalledOnce();
});

it("closing the purpose editor never saves a placement", async () => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const save = vi.fn();
  const close = vi.fn();
  await act(async () => root.render(createElement(AttentionChooser, { onSelect: save, onClose: close, initialPurpose: "旅行" })));
  await click("〇〇に使うから取っておく");
  await act(async () => (host.querySelector('[aria-label="置き場所の選択を閉じる"]') as HTMLButtonElement).click());
  expect(save).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
