interface DrawerChevronIconProps {
  direction: "left" | "right";
  className?: string;
}

/**
 * Tightly paired asymmetric double-chevron for collapsing or expanding
 * sidebars and slide-over panels.
 */
export function DrawerChevronIcon({
  direction,
  className = "h-4 w-4",
}: DrawerChevronIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {direction === "right" ? (
        <>
          <path d="M4.25 5L7.25 8L4.25 11" />
          <path d="M7.5 3.5L12 8L7.5 12.5" />
        </>
      ) : (
        <>
          <path d="M8.5 3.5L4 8L8.5 12.5" />
          <path d="M11.75 5L8.75 8L11.75 11" />
        </>
      )}
    </svg>
  );
}
