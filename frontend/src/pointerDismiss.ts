const KEEP_FOCUS = "a, button, input, select, textarea, summary, label, option, [contenteditable='true'], [role='dialog'], [role='listbox'], [role='menu'], [role='menuitem'], [role='option'], [role='combobox'], [role='textbox']";
const SURFACE = "main, [role='main'], .app, .frame, body";

function isEditable(node: Element | null): node is HTMLElement {
  return (
    !!node &&
    node instanceof HTMLElement &&
    (node.matches("input, select, textarea") || node.isContentEditable)
  );
}

function closeForeignDetails(target: Element) {
  for (const details of document.querySelectorAll<HTMLDetailsElement>("details[open]")) {
    if (!details.contains(target)) details.open = false;
  }
}

function moveFocus(target: Element) {
  if (target.closest(KEEP_FOCUS)) return;
  if (target.closest("[role='dialog'], .modal, .cell-menu, .nav-flyout")) return;
  const surface = target.closest(SURFACE);
  const host = surface instanceof HTMLElement ? surface : document.body;
  if (!host.hasAttribute("tabindex")) host.tabIndex = -1;
  host.focus({ preventScroll: true });
}

function blurForeignField(target: Element) {
  const active = document.activeElement;
  if (!isEditable(active)) return;
  if (active.contains(target) || target === active) return;
  if (target.closest("label")?.contains(active)) return;
  active.blur();
}

export function installPointerDismiss() {
  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 2) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    closeForeignDetails(target);
    blurForeignField(target);
    moveFocus(target);
  }

  document.addEventListener("pointerdown", onPointerDown, true);
  return () => document.removeEventListener("pointerdown", onPointerDown, true);
}
