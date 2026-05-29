"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { trpc } from "@/lib/trpc";
import {
  LayoutDashboard,
  Database,
  FlaskConical,
  GitCompare,
  AlertTriangle,
  PenLine,
  BookOpen,
  FileText,
  ClipboardList,
  Package,
  Table2,
  ShieldCheck,
  TestTubes,
  Settings,
  Beaker,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  approverOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Панель управления", href: "/dashboard", icon: <LayoutDashboard size={20} /> },
  { label: "Эталонный набор", href: "/golden-dataset", icon: <Database size={20} /> },
  { label: "Очередь эксперта", href: "/expert-review", icon: <ShieldCheck size={20} /> },
  { label: "Оценка качества", href: "/evaluation", icon: <FlaskConical size={20} /> },
  { label: "Сравнение LLM", href: "/llm-comparison", icon: <GitCompare size={20} /> },
  { label: "Расхождения", href: "/disagreements", icon: <AlertTriangle size={20} /> },
  { label: "Корректировки", href: "/corrections", icon: <PenLine size={20} /> },
  { label: "Эталонные примеры", href: "/few-shots", icon: <BookOpen size={20} /> },
  { label: "Правила и промпты", href: "/rules", icon: <BookOpen size={20} /> },
  { label: "Аудит обработок", href: "/audit", icon: <ClipboardList size={20} /> },
  { label: "Бандлы конфигурации", href: "/bundles", icon: <Package size={20} /> },
  { label: "SOA", href: "/soa", icon: <Table2 size={20} /> },
  { label: "Согласования", href: "/approvals", icon: <ShieldCheck size={20} />, approverOnly: true },
  { label: "Ревью замечаний", href: "/finding-review", icon: <ClipboardList size={20} /> },
  { label: "Пакетное тестирование", href: "/batch-testing", icon: <TestTubes size={20} /> },
  { label: "Настройка LLM", href: "/llm-config", icon: <Settings size={20} /> },
  { label: "Настройки обработки", href: "/study-settings", icon: <Beaker size={20} /> },
];

const SIDEBAR_KEY = "rule-admin:sidebar-collapsed";

// Роли, которым показываем бейдж «Ревью замечаний». Module-level, чтобы Set
// не пересоздавался на каждый рендер.
const REVIEWER_ROLES = new Set([
  "findings_reviewer",
  "qc_operator",
  "rule_admin",
  "tenant_admin",
]);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { accessToken, user, logout } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === "true") setSidebarCollapsed(true);
  }, []);

  useEffect(() => {
    if (mounted && !accessToken) {
      router.replace("/login");
    }
  }, [mounted, accessToken, router]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    router.push("/login");
  }, [logout, router]);

  const userRole = user?.role ?? "";
  const isReviewer = REVIEWER_ROLES.has(userRole);

  // Badge count для «Ревью замечаний» — pending+in_review reviews.
  // Polling раз в минуту. ВАЖНО: хук должен идти ДО любых early-return ниже,
  // иначе при первом рендере (!mounted) он не вызовется, а на следующем —
  // вызовется → React error #310 (несовпадение числа хуков между рендерами).
  const dashboardQuery = trpc.findingReview.dashboard.useQuery(undefined, {
    enabled: isReviewer,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-brand-600" />
      </div>
    );
  }

  if (!accessToken) return null;

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.approverOnly || userRole === "rule_approver"
  );

  const pendingReviewCount = Array.isArray(dashboardQuery.data)
    ? dashboardQuery.data.filter(
        (r: { status?: string }) => r.status === "pending" || r.status === "in_review",
      ).length
    : 0;

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside
        className={`flex flex-col border-r border-gray-200 bg-white transition-all duration-200 ${
          sidebarCollapsed ? "w-16" : "w-64"
        }`}
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-gray-200 px-4">
          {!sidebarCollapsed && (
            <span className="text-sm font-semibold text-gray-900">Администрирование правил</span>
          )}
          <button
            onClick={toggleSidebar}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2">
          {visibleItems.map((item) => {
            const active = pathname === item.href;
            const showBadge =
              item.href === "/finding-review" && isReviewer && pendingReviewCount > 0;
            return (
              <a
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                  active
                    ? "bg-brand-50 text-brand-700 font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                } ${sidebarCollapsed ? "justify-center" : ""}`}
                title={
                  sidebarCollapsed
                    ? showBadge
                      ? `${item.label} (${pendingReviewCount})`
                      : item.label
                    : undefined
                }
              >
                <span className="relative">
                  {item.icon}
                  {showBadge && sidebarCollapsed && (
                    <span className="absolute -right-1.5 -top-1.5 rounded-full bg-orange-500 px-1 text-[9px] font-bold leading-tight text-white">
                      {pendingReviewCount > 9 ? "9+" : pendingReviewCount}
                    </span>
                  )}
                </span>
                {!sidebarCollapsed && <span className="flex-1">{item.label}</span>}
                {!sidebarCollapsed && showBadge && (
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                    {pendingReviewCount}
                  </span>
                )}
              </a>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-200 p-2">
          <button
            onClick={handleLogout}
            className={`flex w-full items-center gap-3 rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 ${
              sidebarCollapsed ? "justify-center" : ""
            }`}
            title={sidebarCollapsed ? "Выход" : undefined}
          >
            <LogOut size={20} />
            {!sidebarCollapsed && <span>Выход</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50 p-8">{children}</main>
    </div>
  );
}
