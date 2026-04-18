"use client";

import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@clinscriptum/api/src/routers/index.js";

export const trpc = createTRPCReact<AppRouter>();
