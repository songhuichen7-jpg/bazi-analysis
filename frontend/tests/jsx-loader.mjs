/**
 * Minimal Node ESM loader for .jsx files used in unit tests.
 * Only the pure (non-JSX) exports are exercised by tests — we just need
 * the file to parse. We replace JSX syntax with null stubs so Node
 * can load the module without a full Babel/esbuild transform.
 *
 * Strategy:
 * 1. Remove all import statements (React, local components — not needed for pure-export tests)
 * 2. Replace JSX function bodies: anything after `return (` on its own line that contains `<`
 *    through the matching `)` is replaced with `return null`.
 * 3. Remove JSX attribute shorthands and angle brackets.
 */
export async function load(url, context, next) {
  if (!url.endsWith('.jsx')) return next(url, context);

  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');

  const filePath = fileURLToPath(url);
  let source = await readFile(filePath, 'utf-8');

  // Remove all import lines (React, hooks, local imports — unneeded for data-only tests)
  source = source.replace(/^import\s+.*?['"];?\s*$/gm, '');

  // Replace JSX return blocks: `return (\n...JSX...\n  );`
  // Match `return (` followed by content containing `<`, ending at `);` on its own line
  source = source.replace(/return\s*\([\s\S]*?\n\s*\);/g, 'return null;');

  return {
    format: 'module',
    source,
    shortCircuit: true,
  };
}

export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.jsx')) {
    const base = context.parentURL ?? import.meta.url;
    const { pathToFileURL, fileURLToPath } = await import('node:url');
    const { resolve: resolvePath } = await import('node:path');
    const dir = fileURLToPath(new URL('.', base));
    const abs = resolvePath(dir, specifier);
    return { url: pathToFileURL(abs).href, shortCircuit: true };
  }
  return next(specifier, context);
}
