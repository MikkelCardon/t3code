import type { FileDiffContentsLoader, FileDiffMetadata } from "@pierre/diffs";
import { isTestChangedFile } from "@t3tools/shared/changedFileKind";
import { useEffect, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { resolveFileDiffPath } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { basenameOfPath } from "~/pierre-icons";

import { buildChangeFlow, isChangeFlowSource, type ChangeFlowLink } from "./changeFlow.logic";

const MAX_SOURCE_FILES = 80;
const NODE_WIDTH = 156;
const NODE_HEIGHT = 26;
const COLUMN_GAP = 12;
const LAYER_GAP = 40;
const PADDING = 12;
const LABEL_MAX_LENGTH = 22;

interface LoadedContents {
  readonly key: string;
  readonly contentsByPath: ReadonlyMap<string, string>;
}

function shortLabel(path: string): string {
  const name = basenameOfPath(path);
  return name.length > LABEL_MAX_LENGTH ? `${name.slice(0, LABEL_MAX_LENGTH - 1)}…` : name;
}

function layoutNodes(layers: ReadonlyArray<ReadonlyArray<string>>) {
  const widestLayer = Math.max(1, ...layers.map((layer) => layer.length));
  const rowWidth = (count: number) => count * NODE_WIDTH + (count - 1) * COLUMN_GAP;
  const positions = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, layerIndex) => {
    const inset = (rowWidth(widestLayer) - rowWidth(layer.length)) / 2;
    layer.forEach((path, column) => {
      positions.set(path, {
        x: PADDING + inset + column * (NODE_WIDTH + COLUMN_GAP),
        y: PADDING + layerIndex * (NODE_HEIGHT + LAYER_GAP),
      });
    });
  });
  return {
    positions,
    width: rowWidth(widestLayer) + PADDING * 2,
    height: layers.length * NODE_HEIGHT + (layers.length - 1) * LAYER_GAP + PADDING * 2,
  };
}

function LinkList({
  title,
  links,
  pathOf,
  onSelectFile,
}: {
  title: string;
  links: ReadonlyArray<ChangeFlowLink>;
  pathOf: (link: ChangeFlowLink) => string;
  onSelectFile: (path: string) => void;
}) {
  if (links.length === 0) return null;
  return (
    <div>
      <div className="text-muted-foreground/70">{title}</div>
      {links.map((link) => (
        <button
          key={pathOf(link)}
          type="button"
          className="flex w-full gap-2 rounded px-1 py-0.5 text-left hover:bg-accent"
          onClick={() => onSelectFile(pathOf(link))}
        >
          <span className="shrink-0 font-medium text-foreground">
            {basenameOfPath(pathOf(link))}
          </span>
          <span className="min-w-0 truncate text-muted-foreground">{link.names.join(", ")}</span>
        </button>
      ))}
    </div>
  );
}

/** Which changed files import which, callers on top. Links come from import statements. */
export function ChangeFlow({
  files,
  sourceKey,
  loadContents,
  onSelectFile,
}: {
  readonly files: ReadonlyArray<FileDiffMetadata>;
  readonly sourceKey: string;
  readonly loadContents: FileDiffContentsLoader | undefined;
  readonly onSelectFile: (path: string) => void;
}) {
  const [loaded, setLoaded] = useState<LoadedContents | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const paths = files.map(resolveFileDiffPath);
  const sourceFiles = files
    .filter((file) => file.type !== "deleted" && isChangeFlowSource(resolveFileDiffPath(file)))
    .slice(0, MAX_SOURCE_FILES);
  const loadKey = JSON.stringify([sourceKey, sourceFiles.map(resolveFileDiffPath)]);

  const readSourceFiles = useStableCallback((load: FileDiffContentsLoader) =>
    Promise.all(
      sourceFiles.map(async (file) => {
        const path = resolveFileDiffPath(file);
        try {
          return [path, (await load(file)).newFile.contents] as const;
        } catch {
          return [path, file.additionLines.join("")] as const;
        }
      }),
    ),
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the changed files' contents from the environment to find their imports
  useEffect(() => {
    if (!loadContents) return;
    let cancelled = false;
    void readSourceFiles(loadContents).then((entries) => {
      if (!cancelled) setLoaded({ key: loadKey, contentsByPath: new Map(entries) });
    });
    return () => {
      cancelled = true;
    };
  }, [loadContents, loadKey, readSourceFiles]);

  if (loadContents && loaded?.key !== loadKey) {
    return <p className="p-3 text-xs text-muted-foreground/70">Reading imports…</p>;
  }

  // Without file access only the lines inside the diff are known, so links may be missing.
  const contentsOf = (file: FileDiffMetadata) =>
    loaded?.contentsByPath.get(resolveFileDiffPath(file)) ?? file.additionLines.join("");
  const flow = buildChangeFlow(
    sourceFiles.map((file) => ({ path: resolveFileDiffPath(file), contents: contentsOf(file) })),
  );
  if (flow.links.length === 0) {
    return (
      <p className="p-3 text-xs text-muted-foreground/70">No imports between the changed files.</p>
    );
  }

  const { positions, width, height } = layoutNodes(flow.layers);
  const activePath =
    hoveredPath ?? (selectedPath && paths.includes(selectedPath) ? selectedPath : null);
  const touchesActive = (link: ChangeFlowLink) =>
    link.from === activePath || link.to === activePath;
  const isRelated = (path: string) =>
    activePath === null ||
    path === activePath ||
    flow.links.some((link) => touchesActive(link) && (link.from === path || link.to === path));
  const linkedCount = flow.layers.reduce((total, layer) => total + layer.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="min-h-0 flex-1 overflow-auto">
        <svg width={width} height={height} role="img" aria-label="Imports between changed files">
          <defs>
            <marker
              id="change-flow-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M1 1L9 5L1 9" fill="none" stroke="context-stroke" strokeWidth="1.5" />
            </marker>
          </defs>
          {flow.links.map((link) => {
            const from = positions.get(link.from)!;
            const to = positions.get(link.to)!;
            const startX = from.x + NODE_WIDTH / 2;
            const startY = from.y + NODE_HEIGHT;
            const endX = to.x + NODE_WIDTH / 2;
            const bend = LAYER_GAP / 2;
            return (
              <path
                key={`${link.from}\u0000${link.to}`}
                d={`M${startX} ${startY}C${startX} ${startY + bend},${endX} ${to.y - bend},${endX} ${to.y}`}
                fill="none"
                markerEnd="url(#change-flow-arrow)"
                strokeDasharray={isTestChangedFile(link.from) ? "4 3" : undefined}
                className={cn(
                  "stroke-muted-foreground/60",
                  activePath !== null && (touchesActive(link) ? "stroke-primary" : "opacity-20"),
                )}
              />
            );
          })}
          {flow.layers.flat().map((path) => {
            const { x, y } = positions.get(path)!;
            return (
              <g
                key={path}
                role="button"
                tabIndex={0}
                aria-label={path}
                className={cn("cursor-pointer outline-none", !isRelated(path) && "opacity-30")}
                onPointerEnter={() => setHoveredPath(path)}
                onPointerLeave={() => setHoveredPath(null)}
                onClick={() => {
                  setSelectedPath(path);
                  onSelectFile(path);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setSelectedPath(path);
                  onSelectFile(path);
                }}
              >
                <title>{path}</title>
                <rect
                  x={x}
                  y={y}
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx={6}
                  strokeDasharray={isTestChangedFile(path) ? "4 3" : undefined}
                  className={cn(
                    "fill-background stroke-border",
                    path === selectedPath && "fill-accent stroke-primary",
                  )}
                />
                <text
                  x={x + NODE_WIDTH / 2}
                  y={y + NODE_HEIGHT / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={cn(
                    "font-mono text-2xs",
                    isTestChangedFile(path) ? "fill-muted-foreground" : "fill-foreground",
                  )}
                >
                  {shortLabel(path)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="max-h-[40%] shrink-0 space-y-1 overflow-auto border-t border-border/60 p-2">
        {activePath === null ? (
          <p className="text-muted-foreground/70">
            {linkedCount} of {paths.length} files import each other. Dashed is a test.
          </p>
        ) : (
          <>
            <LinkList
              title="Imports"
              links={flow.links.filter((link) => link.from === activePath)}
              pathOf={(link) => link.to}
              onSelectFile={onSelectFile}
            />
            <LinkList
              title="Imported by"
              links={flow.links.filter((link) => link.to === activePath)}
              pathOf={(link) => link.from}
              onSelectFile={onSelectFile}
            />
          </>
        )}
      </div>
    </div>
  );
}
