import { useEffect } from "react";
import { confirmDiscard } from "./ui";

let depth = 0;

function onClick(event: MouseEvent) {
  if (depth === 0 || event.defaultPrevented) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const anchor = (event.target as Element | null)?.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  if (anchor.target && anchor.target !== "_self") return;
  const next = new URL(anchor.href, window.location.href);
  if (next.origin !== window.location.origin) return;
  if (next.pathname + next.search === window.location.pathname + window.location.search) return;
  if (!confirmDiscard(true)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function onPop() {
  if (depth === 0) return;
  if (confirmDiscard(true)) return;
  history.go(1);
}

export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    depth += 1;
    if (depth === 1) {
      document.addEventListener("click", onClick, true);
      window.addEventListener("popstate", onPop);
    }
    function onLeave(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onLeave);
    return () => {
      depth -= 1;
      if (depth === 0) {
        document.removeEventListener("click", onClick, true);
        window.removeEventListener("popstate", onPop);
      }
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [dirty]);
}
