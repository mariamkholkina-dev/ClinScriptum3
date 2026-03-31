"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/lib/auth-store";
import {
  FileText,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Settings,
  GitCompare,
  Wand2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Главная", icon: LayoutDashboard },
  { href: "/studies", label: "Исследования", icon: FlaskConical },
  { href: "/documents", label: "Документы", icon: FileText },
  { href: "/compare", label: "Сравнение", icon: GitCompare },
  { href: "/generate", label: "Генерация", icon: Wand2 },
  { href: "/settings", label: "Настройки", icon: Settings },
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-gray-200 bg-white transition-all duration-200",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo + toggle */}
      <div className="flex h-16 items-center border-b px-3">
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2 flex-1 min-w-0">
            <FlaskConical className="h-6 w-6 text-brand-600 flex-shrink-0" />
            <span className="text-lg font-semibold text-gray-900 truncate">ClinScriptum</span>
          </Link>
        )}
        {collapsed && (
          <Link href="/dashboard" className="flex-1 flex justify-center">
            <FlaskConical className="h-6 w-6 text-brand-600" />
          </Link>
        )}
        <button
          onClick={onToggle}
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 flex-shrink-0"
          title={collapsed ? "Развернуть меню" : "Свернуть меню"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t p-3">
        {!collapsed && (
          <div className="mb-2 text-xs text-gray-500 truncate px-1">{user?.email}</div>
        )}
        <button
          onClick={logout}
          title={collapsed ? "Выйти" : undefined}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut className="h-4 w-4 flex-shrink-0" />
          {!collapsed && "Выйти"}
        </button>
      </div>
    </aside>
  );
}
