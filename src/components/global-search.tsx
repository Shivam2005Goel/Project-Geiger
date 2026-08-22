'use client';

import * as React from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import type { PaperNode } from '@/lib/types';
import { FileText, Search } from 'lucide-react';

interface GlobalSearchProps {
  nodes: PaperNode[];
  onSelect: (node: PaperNode) => void;
}

export function GlobalSearch({ nodes, onSelect }: GlobalSearchProps) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-sm text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
      >
        <Search className="h-4 w-4" />
        <span>Search papers...</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-white/20 bg-white/10 px-1.5 font-mono text-[10px] font-medium text-slate-300 opacity-100">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a title or DOI..." />
        <CommandList className="bg-slate-950 text-slate-200 border-white/10 border-t">
          <CommandEmpty>No papers found.</CommandEmpty>
          <CommandGroup heading="Graph Nodes">
            {nodes.map((node) => (
              <CommandItem
                key={node.id}
                onSelect={() => {
                  onSelect(node);
                  setOpen(false);
                }}
                className="flex items-center gap-2 cursor-pointer aria-selected:bg-sky-600/30"
              >
                <FileText className="h-4 w-4 shrink-0 text-slate-500" />
                <div className="flex flex-col min-w-0">
                  <span className="truncate text-sm font-medium">{node.title ?? node.doi ?? node.id}</span>
                  {node.doi && <span className="text-xs text-slate-500">{node.doi}</span>}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
