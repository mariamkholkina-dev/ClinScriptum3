"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import {
  LayoutDashboard,
  Database,
  FlaskConical,
  GitCompare,
  AlertTriangle,
  PenLine,
  BookOpen,
  FileText,
  Package,
  Table2,
  ShieldCheck,
  TestTubes,
  Settings,
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
  { label: "Оценка качества", href: "/evaluation", icon: <FlaskConical size={20} /> },
  { label: "Сравнение LLM", href: "/llm-comparison", icon: <GitCompare size={20} /> },
  { label: "Расхождения", href: "/disagreements", icon: <AlertTriangle size={20} /> },
  { label: "Корректировки", href: "/corrections", icon: <PenLine size={20} /> },
  { label: "Правила и промпты", href: "/rules", icon: <BookOpen size={20} /> },
  { label: "Бандлы конфигурации", href: "/bundles", icon: <Package size={20} /> },
  { label: "SOA", href: "/soa", icon: <Table2 size={20} /> },
  { label: "Согласования", href: "/approvals", icon: <ShieldCheck size={20} />, approverOnly: true },
  { label: "Пакетное тестирование", href: "/batch-testing", icon: <TestTubes size={20} /> },
  { label: "Настройка LLM", href: "/llm-config", icon: <Settings size={20} /> },
];

const SIDEBAR_KEY = "rule-admin:sidebar-collapsed";

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

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-brand-600" />
      </div>
    );
  }

  if (!accessToken) return null;

  const userRole = user?.role ?? "";
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.approverOnly || userRole === "rule_approver"
  );

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
            return (
              <a
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                  active
                    ? "bg-brand-50 text-brand-700 font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                } ${sidebarCollapsed ? "justify-center" : ""}`}
                title={sidebarCollapsed ? item.label : undefined}
              >
                {item.icon}
                {!sidebarCollapsed && <span>{item.label}</span>}
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
