import { RollupPluginHtml } from '@web/rollup-plugin-html';
import { Plugin } from 'rollup';
import { GeneratedFile, injectPolyfillsLoader, File } from '@web/polyfills-loader';
import path from 'path';

import { RollupPluginPolyfillsLoaderConfig } from './types';
import { createError, shouldInjectLoader } from './utils';
import { createPolyfillsLoaderConfig } from './createPolyfillsLoaderConfig';

export function polyfillsLoader(pluginOptions: RollupPluginPolyfillsLoaderConfig = {}): Plugin {
  let generatedFiles: GeneratedFile[] | undefined;

  return {
    name: '@web/rollup-plugin-polyfills-loader',

    buildStart(options) {
      generatedFiles = undefined;
      if (!options.plugins) {
        throw createError('Could not find any installed plugins');
      }

      const htmlPlugins = options.plugins.filter(
        p => p.name === '@web/rollup-plugin-html',
      ) as RollupPluginHtml[];
      const [htmlPlugin] = htmlPlugins;

      if (!htmlPlugin) {
        throw createError(
          'Could not find any instance of @web/rollup-plugin-html in rollup build.',
        );
      }

      htmlPlugin.api.disableDefaultInject();
      htmlPlugin.api.addHtmlTransformer(async (html, { bundle, bundles }) => {
        const config = createPolyfillsLoaderConfig(pluginOptions, bundle, bundles);
        let htmlString = html;

        if (shouldInjectLoader(config)) {
          const result = await injectPolyfillsLoader(html, config);
          htmlString = result.htmlString;
          generatedFiles = result.polyfillFiles;
        } else {
          // we don't need to inject a polyfills loader, so we just inject the scripts directly
          const scripts = config
            .modern!.files.map((f: File) => `<script type="module" src="${f.path}"></script>\n`)
            .join('');
          htmlString = htmlString.replace('</body>', `\n${scripts}\n</body>`);
        }

        // preload all entrypoints as well as their direct dependencies
        const { entrypoints } = pluginOptions.modernOutput
          ? bundles[pluginOptions.modernOutput.name]
          : bundle;

        let preloaded = [];
        for (const entrypoint of entrypoints) {
          preloaded.push(entrypoint.importPath);

          // js files (incl. chunks) will always be in the root directory
          const pathToRoot = path.posix.relative('./', path.posix.dirname(entrypoint.importPath));
          for (const chunkPath of entrypoint.chunk.imports) {
            preloaded.push(path.posix.join(pathToRoot, chunkPath));
          }
        }
        preloaded = [...new Set(preloaded)];

        return htmlString.replace(
          '</head>',
          `\n${preloaded
            .map(i => `<link rel="preload" href="${i}" as="script" crossorigin="anonymous">\n`)
            .join('')}</head>`,
        );
      });
    },

    generateBundle(_, bundle) {
      if (generatedFiles) {
        for (const file of generatedFiles) {
          // if the polyfills loader is used multiple times, this polyfill might already be output
          // so we guard against that. polyfills are already hashed, so there is no need to worry
          // about clashing
          if (!(file.path in bundle)) {
            this.emitFile({
              type: 'asset',
              name: file.path,
              fileName: file.path,
              source: file.content,
            });
          }
        }
      }
    },
  };
}
