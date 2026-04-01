/**
 * @file tests/unit/bun-preload.ts
 * @description Global preload script for Bun unit tests.
 * Registers the Svelte 5 compiler plugin to enable native Svelte component testing in Bun.
 *
 * ### Features:
 * - Native Svelte 5 SSR compilation for Bun
 * - Automatic default export handling for compiled components
 * - Global test environment setup
 */

import { plugin } from "bun";
import { compile } from "svelte/compiler";

// Register Svelte 5 compiler plugin for Bun - GLOBAL PRELOAD
plugin({
  name: "svelte-loader",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      // Always server for Bun unit tests to support SSR testing
      const { js } = compile(source, {
        filename: path,
        generate: "server",
        dev: false, // Disable dev to avoid complex SSR context requirements
      });

      let contents = js.code;

      // Svelte 5 SSR (generate: "server") exports the component.
      // We need to ensure it's compatible with our render() mock/shim if needed,
      // but native Svelte 5 SSR components should just work if we call them correctly.

      // If it's a Svelte 5 component, it often uses a pattern that doesn't
      // play well with some test runners. We ensure a default export exists.
      if (!contents.includes("export default")) {
        const functionName = contents.match(/function\s+(\w+)/)?.[1];
        if (functionName) {
          contents += `\nexport default ${functionName};`;
        }
      }

      // Svelte 5 SSR components are functions that take (result, props)
      // and return a string or an object with body/head.
      // Our tests expect a render(Component, { props }) function.

      return {
        contents,
        loader: "js",
      };
    });
  },
});
