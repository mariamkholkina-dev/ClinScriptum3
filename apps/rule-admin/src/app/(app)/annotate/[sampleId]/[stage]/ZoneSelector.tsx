"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Search, ChevronRight, X } from "lucide-react";

interface TaxonomyRule {
  name: string;
  pattern: string;
  config: unknown;
}

interface ZoneNode {
  key: string;          // canonical zone key, e.g. "ip"
  pattern: string;      // canonical_zone string, e.g. "ip"
  titleRu: string;
  type: "zone" | "subzone";
  parentZone: string | null;
  children: ZoneNode[];
}

interface Props {
  rules: TaxonomyRule[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  // optional className for outer button
  className?: string;
}

/* ────────── helpers ────────── */

function buildTree(rules: TaxonomyRule[]): ZoneNode[] {
  const zoneByKey = new Map<string, ZoneNode>();

  // Pass 1: collect all zones (top-level)
  for (const r of rules) {
    const cfg = (r.config ?? {}) as {
      type?: string;
      key?: string;
      titleRu?: string;
      parentZone?: string;
    };
    if (cfg.type !== "zone") continue;
    const key = cfg.key ?? r.pattern;
    if (!zoneByKey.has(key)) {
      zoneByKey.set(key, {
        key,
        pattern: r.pattern,
        titleRu: cfg.titleRu ?? "",
        type: "zone",
        parentZone: null,
        children: [],
      });
    } else {
      const existing = zoneByKey.get(key)!;
      existing.titleRu ||= cfg.titleRu ?? "";
      existing.pattern = r.pattern;
    }
  }

  // Pass 2: subzones
  for (const r of rules) {
    const cfg = (r.config ?? {}) as {
      type?: string;
      key?: string;
      titleRu?: string;
      parentZone?: string;
    };
    if (cfg.type !== "subzone" || !cfg.parentZone) continue;
    const parent = zoneByKey.get(cfg.parentZone);
    if (!parent) continue;
    parent.children.push({
      key: cfg.key ?? r.pattern,
      pattern: r.pattern,
      titleRu: cfg.titleRu ?? "",
      type: "subzone",
      parentZone: cfg.parentZone,
      children: [],
    });
  }

  // Sort: zones alphabetically, subzones inside each zone alphabetically
  const arr = Array.from(zoneByKey.values()).sort((a, b) => a.key.localeCompare(b.key));
  for (const z of arr) z.children.sort((a, b) => a.pattern.localeCompare(b.pattern));
  return arr;
}

function flattenForSelect(tree: ZoneNode[]): ZoneNode[] {
  const out: ZoneNode[] = [];
  for (const z of tree) {
    out.push(z);
    for (const s of z.children) out.push(s);
  }
  return out;
}

function matches(node: ZoneNode, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    node.pattern.toLowerCase().includes(ql) ||
    node.key.toLowerCase().includes(ql) ||
    node.titleRu.toLowerCase().includes(ql)
  );
}

/* ────────── component ────────── */

export function ZoneSelector({ rules, value, onChange, placeholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => buildTree(rules), [rules]);

  // Filter tree by search — keep zone if it matches OR any of its subzones matches
  const filteredTree = useMemo(() => {
    if (!search) return tree;
    return tree
      .map((z) => {
        const childMatches = z.children.filter((c) => matches(c, search));
        const zoneMatches = matches(z, search);
        if (!zoneMatches && childMatches.length === 0) return null;
        return { ...z, children: zoneMatches ? z.children : childMatches };
      })
      .filter((x): x is ZoneNode => x !== null);
  }, [tree, search]);

  // Flat list for keyboard navigation (zone + each child appears as a row)
  const flat = useMemo(() => flattenForSelect(filteredTree), [filteredTree]);

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [search, filteredTree.length]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus input on open
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const select = useCallback(
    (node: ZoneNode) => {
      onChange(node.pattern);
      setOpen(false);
      setSearch("");
    },
    [onChange],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const node = flat[highlightIdx];
      if (node) select(node);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Find current selection's display label
  const currentDisplay = useMemo(() => {
    const allFlat = flattenForSelect(tree);
    const found = allFlat.find((n) => n.pattern === value || n.key === value);
    if (!found) return value || "";
    return found.titleRu ? `${found.pattern} — ${found.titleRu}` : found.pattern;
  }, [tree, value]);

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded border border-gray-300 bg-white px-3 py-2 text-left text-sm hover:border-gray-400 focus:border-brand-500 focus:outline-none"
      >
        <span className={value ? "text-gray-900" : "text-gray-400"}>
          {currentDisplay || placeholder || "— выбери зону —"}
        </span>
        <ChevronDown size={14} className="text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full max-w-2xl overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
          {/* Search input */}
          <div className="border-b border-gray-200 p-2">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Поиск зоны или подзоны..."
                className="w-full rounded border border-gray-300 bg-gray-50 py-1.5 pl-7 pr-7 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Tree */}
          <div className="max-h-80 overflow-y-auto py-1">
            {filteredTree.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400">Ничего не найдено</div>
            ) : (
              filteredTree.map((zone) => {
                const zoneFlatIdx = flat.indexOf(zone);
                const isZoneHighlighted = zoneFlatIdx === highlightIdx;
                const isZoneSelected = zone.pattern === value || zone.key === value;
                return (
                  <div key={zone.pattern}>
                    <button
                      type="button"
                      onClick={() => select(zone)}
                      onMouseEnter={() => setHighlightIdx(zoneFlatIdx)}
                      className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${
                        isZoneHighlighted ? "bg-brand-50" : ""
                      } ${isZoneSelected ? "bg-brand-100 font-semibold" : ""}`}
                    >
                      <ChevronRight size={12} className="text-gray-400" />
                      <code className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono">
                        {zone.pattern}
                      </code>
                      <span className="truncate text-gray-700">{zone.titleRu}</span>
                    </button>
                    {zone.children.map((sub) => {
                      const subFlatIdx = flat.indexOf(sub);
                      const isHighlighted = subFlatIdx === highlightIdx;
                      const isSelected = sub.pattern === value || sub.key === value;
                      return (
                        <button
                          key={sub.pattern}
                          type="button"
                          onClick={() => select(sub)}
                          onMouseEnter={() => setHighlightIdx(subFlatIdx)}
                          className={`flex w-full items-center gap-2 px-2 py-1 pl-8 text-left text-sm ${
                            isHighlighted ? "bg-brand-50" : ""
                          } ${isSelected ? "bg-brand-100 font-semibold" : ""}`}
                        >
                          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono">
                            {sub.pattern}
                          </code>
                          <span className="truncate text-gray-600">{sub.titleRu}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
