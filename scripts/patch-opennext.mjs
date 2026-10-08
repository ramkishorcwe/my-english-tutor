import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Next 16.4 split draft-mode props out of prerender-manifest.json. OpenNext
// 1.20.9's manifest glob omits preview-props.json, so inline the real generated
// manifest using the same strategy as its other manifests. Never synthesize it.
export function inlinePreviewProps() {
  const manifest = '.next/server/preview-props.json';
  if (!existsSync(manifest)) return;
  const filename = '.open-next/server-functions/default/handler.mjs';
  const code = readFileSync(filename, 'utf8');
  if (/\.endsWith\(['"]\/server\/preview-props\.json['"]\)/.test(code)) return;
  const pattern = /function loadManifest\(([\w$]+)[^)]*\)\{/g;
  const matches = [...code.matchAll(pattern)];
  if (matches.length !== 1)
    throw new Error('OpenNext manifest loader changed; review the compatibility patch');
  const props = JSON.parse(readFileSync(manifest, 'utf8'));
  for (const key of ['previewModeId', 'previewModeSigningKey', 'previewModeEncryptionKey']) {
    if (typeof props[key] !== 'string') throw new Error('Invalid generated preview props');
  }
  const argument = matches[0][1];
  const insert = `if(${argument}.replaceAll('\\\\','/').endsWith('/server/preview-props.json'))return ${JSON.stringify(props)};`;
  writeFileSync(
    filename,
    code.replace(pattern, (start) => start + insert),
  );
}
