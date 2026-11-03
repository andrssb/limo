import React from "react";

export function LimoSymbol({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Speech bubble body */}
      <rect x="0" y="0" width="23" height="20" rx="5" fill="#a3e635" />
      {/* Bubble tail bottom-left */}
      <polygon points="3,20 1,27 12,20" fill="#a3e635" />
      {/* Checkmark in navy */}
      <path
        d="M5 10 L9.5 15 L19 5"
        stroke="#0f172a"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Growth arrow right side */}
      <line
        x1="28.5" y1="27" x2="28.5" y2="9"
        stroke="#a3e635"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M25.5 13 L28.5 9 L31.5 13"
        stroke="#a3e635"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
