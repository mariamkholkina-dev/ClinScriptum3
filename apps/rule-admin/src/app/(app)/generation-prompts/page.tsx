"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function GenerationPromptsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/rules?group=Генерация");
  }, [router]);
  return null;
}
