import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { ZoomIn, ZoomOut } from "lucide-react";

export type LessonMedia =
  | { kind: "image"; src: string; alt: string; title?: string }
  | { kind: "diagram"; svg: string; title: string };

interface LessonMediaViewerProps {
  media: LessonMedia;
  onClose: () => void;
}

export function LessonMediaViewer({
  media,
  onClose,
}: LessonMediaViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const zoomRef = useRef(zoom);
  const dragStartRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
  } | null>(null);
  onCloseRef.current = onClose;
  zoomRef.current = zoom;

  const changeZoom = (change: number) => {
    const next = Math.min(3, Math.max(0.25, zoomRef.current + change));
    zoomRef.current = next;
    setZoom(next);
    if (next <= 1) {
      dragStartRef.current = null;
      setPan({ x: 0, y: 0 });
      setIsPanning(false);
    }
  };
  const changeZoomRef = useRef(changeZoom);
  changeZoomRef.current = changeZoom;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeZoomRef.current(0.25);
      } else if (event.key === "-") {
        event.preventDefault();
        changeZoomRef.current(-0.25);
      } else if (event.key === "0") {
        changeZoomRef.current(1 - zoomRef.current);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoomRef.current <= 1 || event.button !== 0) return;
    event.preventDefault();
    dragStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setPan({
      x: start.panX + event.clientX - start.clientX,
      y: start.panY + event.clientY - start.clientY,
    });
  };

  const finishPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current?.pointerId !== event.pointerId) return;
    dragStartRef.current = null;
    setIsPanning(false);
  };

  const themeRoot =
    document.querySelector<HTMLElement>(".app-shell[data-theme]") ??
    document.documentElement;
  const themeBackground =
    getComputedStyle(themeRoot).getPropertyValue("--color-app-bg").trim() ||
    "#f5f6f3";
  const label =
    media.kind === "image"
      ? media.alt || media.title || "Enlarged lesson image"
      : media.title;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-auto p-4 outline-none"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.45)" }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="group relative flex h-[80vh] w-[90vw] items-center justify-center overflow-hidden rounded-xl sm:h-[70vh] sm:w-[68vw]"
        style={{ backgroundColor: themeBackground }}
        onWheel={(event) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          changeZoom(event.deltaY < 0 ? 0.25 : -0.25);
        }}
      >
        <div
          className={`flex h-full w-full items-center justify-center overflow-hidden p-2 ${
            zoom > 1 ? (isPanning ? "cursor-grabbing" : "cursor-grab") : ""
          }`}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={finishPan}
          onPointerCancel={finishPan}
          style={{ touchAction: zoom > 1 ? "none" : "auto" }}
        >
          {media.kind === "image" ? (
            <img
              src={media.src}
              alt={media.alt}
              draggable={false}
              className="pointer-events-none max-h-full max-w-full select-none object-contain transition-transform duration-150 ease-out motion-reduce:transition-none"
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                transformOrigin: "center center",
              }}
            />
          ) : (
            <div
              role="img"
              aria-label={media.title}
              className="pointer-events-none flex h-full w-full items-center justify-center [&_svg]:!max-h-full [&_svg]:!max-w-full"
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                transformOrigin: "center center",
              }}
              dangerouslySetInnerHTML={{ __html: media.svg }}
            />
          )}
        </div>
        <div className="absolute bottom-3 right-3 flex gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] p-1 opacity-100 shadow-md transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => changeZoom(-0.25)}
            disabled={zoom <= 0.25}
            className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] p-2 text-[var(--color-ink)] hover:bg-[var(--color-hover)] disabled:opacity-40"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => changeZoom(0.25)}
            disabled={zoom >= 3}
            className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] p-2 text-[var(--color-ink)] hover:bg-[var(--color-hover)] disabled:opacity-40"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
