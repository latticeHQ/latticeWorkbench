export function LoadingScreen(props: { statusText?: string }) {
  // Keep the markup/classes in sync with index.html's boot loader so the inline styles
  // apply immediately and we avoid a flash of unstyled / missing spinner before Tailwind/globals.css loads.
  return (
    <div className="boot-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="boot-loader__inner">
        <svg
          className="boot-loader__spinner"
          viewBox="0 0 156 157"
          xmlns="http://www.w3.org/2000/svg"
          overflow="hidden"
          aria-hidden="true"
        >
          <path
            className="boot-loader__hex"
            d="M39 58.5 78 39 117 58.5 117 97.5 78 117 39 97.5Z"
            stroke="currentColor"
            strokeWidth="2.4375"
            fill="none"
          />
          <circle
            className="boot-loader__node"
            cx="78"
            cy="78.5"
            r="4.875"
            stroke="currentColor"
            strokeWidth="2.4375"
            fill="none"
          />
          <line
            className="boot-loader__link"
            x1="58.5"
            y1="78.5"
            x2="97.5"
            y2="78.5"
            stroke="currentColor"
            strokeWidth="2.4375"
          />
        </svg>
        <p className="boot-loader__text">{props.statusText ?? "Loading minions..."}</p>
      </div>
    </div>
  );
}
