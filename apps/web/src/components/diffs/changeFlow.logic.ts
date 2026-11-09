export interface ChangeFlowLink {
  readonly from: string;
  readonly to: string;
  readonly names: ReadonlyArray<string>;
}

export interface ChangeFlowGraph {
  /** Linked files, callers first: a file sits below every changed file that imports it. */
  readonly layers: ReadonlyArray<ReadonlyArray<string>>;
  readonly links: ReadonlyArray<ChangeFlowLink>;
}

const SCRIPT_EXTENSION = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
const INDEX_SUFFIX = /\/index$/;
const IMPORT_PATTERN =
  /\b(?:import|export)\s+(?:type\s+)?([\w$*\s{},]*?)\s*from\s*["']([^"']+)["']|\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g;

export function isChangeFlowSource(path: string): boolean {
  return SCRIPT_EXTENSION.test(path);
}

function stemOf(path: string): string {
  return path.replace(SCRIPT_EXTENSION, "").replace(INDEX_SUFFIX, "");
}

function importedNames(clause: string | undefined): ReadonlyArray<string> {
  if (!clause) return [];
  return clause
    .replace(/[{}]/g, ",")
    .split(",")
    .map((name) =>
      name
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]!
        .trim(),
    )
    .filter((name) => name.length > 0 && name !== "*");
}

function joinRelative(fromPath: string, specifier: string): string {
  const segments = fromPath.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment !== "." && segment !== "") segments.push(segment);
  }
  return segments.join("/");
}

// Aliases and workspace packages are not resolved through tsconfig: the part after
// the alias or package name must end exactly one changed path.
function aliasedRemainder(specifier: string): string | null {
  const segments = specifier.split("/");
  const prefixLength = /^[@~#]$/.test(segments[0]!) ? 1 : segments[0]!.startsWith("@") ? 2 : 0;
  if (prefixLength === 0 || segments.length <= prefixLength) return null;
  return stemOf(segments.slice(prefixLength).join("/"));
}

function createResolver(paths: ReadonlyArray<string>) {
  const exact = new Set(paths);
  const pathsByStem = new Map<string, string>();
  for (const path of paths) {
    if (isChangeFlowSource(path) && !pathsByStem.has(stemOf(path))) {
      pathsByStem.set(stemOf(path), path);
    }
  }
  return (fromPath: string, specifier: string): string | null => {
    if (specifier.startsWith(".")) {
      const target = joinRelative(fromPath, specifier);
      return exact.has(target) ? target : (pathsByStem.get(stemOf(target)) ?? null);
    }
    const baseUrlMatch = pathsByStem.get(stemOf(specifier));
    if (baseUrlMatch) return baseUrlMatch;
    const remainder = aliasedRemainder(specifier);
    if (remainder === null) return null;
    const matches = [...pathsByStem].filter(
      ([stem]) => stem === remainder || stem.endsWith(`/${remainder}`),
    );
    return matches.length === 1 ? matches[0]![1] : null;
  };
}

function layerLinkedFiles(
  paths: ReadonlyArray<string>,
  links: ReadonlyArray<ChangeFlowLink>,
): ReadonlyArray<ReadonlyArray<string>> {
  const importersByPath = new Map<string, string[]>();
  const linked = new Set<string>();
  for (const link of links) {
    linked.add(link.from).add(link.to);
    importersByPath.set(link.to, [...(importersByPath.get(link.to) ?? []), link.from]);
  }
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (path: string): number => {
    const known = depths.get(path);
    if (known !== undefined) return known;
    visiting.add(path);
    let depth = 0;
    for (const importer of importersByPath.get(path) ?? []) {
      // An import cycle has no top; the edge that closes it does not push the file down.
      if (!visiting.has(importer)) depth = Math.max(depth, depthOf(importer) + 1);
    }
    visiting.delete(path);
    depths.set(path, depth);
    return depth;
  };
  const layers: string[][] = [];
  for (const path of paths) {
    if (!linked.has(path)) continue;
    (layers[depthOf(path)] ??= []).push(path);
  }
  return layers.filter((layer) => layer !== undefined);
}

export function buildChangeFlow(
  files: ReadonlyArray<{ readonly path: string; readonly contents: string }>,
): ChangeFlowGraph {
  const paths = files.map((file) => file.path);
  const resolve = createResolver(paths);
  const namesByLink = new Map<string, { from: string; to: string; names: Set<string> }>();
  for (const file of files) {
    if (!isChangeFlowSource(file.path)) continue;
    for (const match of file.contents.matchAll(IMPORT_PATTERN)) {
      const target = resolve(file.path, match[2] ?? match[3] ?? match[4]!);
      if (target === null || target === file.path) continue;
      const key = `${file.path}\u0000${target}`;
      const link = namesByLink.get(key) ?? { from: file.path, to: target, names: new Set() };
      for (const name of importedNames(match[1])) link.names.add(name);
      namesByLink.set(key, link);
    }
  }
  const links = [...namesByLink.values()].map((link) => ({ ...link, names: [...link.names] }));
  return { layers: layerLinkedFiles(paths, links), links };
}
