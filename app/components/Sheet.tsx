import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons";

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A bottom sheet with a backdrop. Closes on backdrop click and on Escape,
 * and moves focus inside on open so keyboard and screen-reader users are not
 * left behind on the page underneath.
 */
export function Sheet({ title, onClose, children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    // Focus the first control, or the panel itself if the form is empty.
    panel.current?.querySelector<HTMLElement>("input, button, select")?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="sheet"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <CloseIcon size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
