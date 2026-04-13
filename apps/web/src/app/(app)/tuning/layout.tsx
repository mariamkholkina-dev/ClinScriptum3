"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";

export default function TuningLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuthStore();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (user && user.role !== "tenant_admin" && user.role !== "rule_admin") {
      router.replace("/dashboard");
    } else {
      setChecked(true);
    }
  }, [user, router]);

  if (!checked) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-brand-600" />
      </div>
    );
  }

  return <>{children}</>;
}
