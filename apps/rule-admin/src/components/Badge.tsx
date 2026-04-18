"use client";

type BadgeVariant = "green" | "gray" | "red" | "yellow" | "blue";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  green: "bg-green-50 text-green-700 ring-green-600/20",
  gray: "bg-gray-50 text-gray-600 ring-gray-500/10",
  red: "bg-red-50 text-red-700 ring-red-600/10",
  yellow: "bg-yellow-50 text-yellow-800 ring-yellow-600/20",
  blue: "bg-blue-50 text-blue-700 ring-blue-700/10",
};

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
}

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </span>
  );
}
