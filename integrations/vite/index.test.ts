import path from 'node:path'
import { describe, expect } from 'vitest'
import {
  candidate,
  css,
  fetchStyles,
  html,
  js,
  json,
  retryAssertion,
  test,
  ts,
  txt,
  yaml,
} from '../utils'

for (let transformer of ['postcss', 'lightningcss']) {
  describe(transformer, () => {
    test(
      `production build`,
      {
        fs: {
          'package.json': json`{}`,
          'pnpm-workspace.yaml': yaml`
            #
            packages:
              - project-a
          `,
          'project-a/package.json': txt`
            {
              "type": "module",
              "dependencies": {
                "@tailwindcss/vite": "workspace:^",
                "tailwindcss": "workspace:^"
              },
              "devDependencies": {
                ${transformer === 'lightningcss' ? `"lightningcss": "^1.26.0",` : ''}
                "vite": "^5.3.5"
              }
            }
          `,
          'project-a/vite.config.ts': ts`
            import tailwindcss from '@tailwindcss/vite'
            import { defineConfig } from 'vite'

            export default defineConfig({
              css: ${transformer === 'postcss' ? '{}' : "{ transformer: 'lightningcss' }"},
              build: { cssMinify: false },
              plugins: [tailwindcss()],
            })
          `,
          'project-a/index.html': html`
            <head>
              <link rel="stylesheet" href="./src/index.css" />
            </head>
            <body>
              <div class="underline m-2">Hello, world!</div>
            </body>
          `,
          'project-a/tailwind.config.js': js`
            export default {
              content: ['../project-b/src/**/*.js'],
            }
          `,
          'project-a/src/index.css': css`
            @import 'tailwindcss/theme' theme(reference);
            @import 'tailwindcss/utilities';
            @config '../tailwind.config.js';
            @source '../../project-b/src/**/*.html';
          `,
          'project-b/src/index.html': html`
            <div class="flex" />
          `,
          'project-b/src/index.js': js`
            const className = "content-['project-b/src/index.js']"
            module.exports = { className }
          `,
        },
      },
      async ({ root, fs, exec }) => {
        await exec('pnpm vite build', { cwd: path.join(root, 'project-a') })

        let files = await fs.glob('project-a/dist/**/*.css')
        expect(files).toHaveLength(1)
        let [filename] = files[0]

        await fs.expectFileToContain(filename, [
          candidate`underline`,
          candidate`m-2`,
          candidate`flex`,
          candidate`content-['project-b/src/index.js']`,
        ])
      },
    )

    test(
      `dev mode`,
      {
        fs: {
          'package.json': json`{}`,
          'pnpm-workspace.yaml': yaml`
            #
            packages:
              - project-a
          `,
          'project-a/package.json': txt`
            {
              "type": "module",
              "dependencies": {
                "@tailwindcss/vite": "workspace:^",
                "tailwindcss": "workspace:^"
              },
              "devDependencies": {
                ${transformer === 'lightningcss' ? `"lightningcss": "^1.26.0",` : ''}
                "vite": "^5.3.5"
              }
            }
          `,
          'project-a/vite.config.ts': ts`
            import tailwindcss from '@tailwindcss/vite'
            import { defineConfig } from 'vite'

            export default defineConfig({
              css: ${transformer === 'postcss' ? '{}' : "{ transformer: 'lightningcss' }"},
              build: { cssMinify: false },
              plugins: [tailwindcss()],
            })
          `,
          'project-a/index.html': html`
            <head>
              <link rel="stylesheet" href="./src/index.css" />
            </head>
            <body>
              <div class="underline">Hello, world!</div>
            </body>
          `,
          'project-a/about.html': html`
            <head>
              <link rel="stylesheet" href="./src/index.css" />
            </head>
            <body>
              <div class="font-bold">Tailwind Labs</div>
            </body>
          `,
          'project-a/tailwind.config.js': js`
            export default {
              content: ['../project-b/src/**/*.js'],
            }
          `,
          'project-a/src/index.css': css`
            @import 'tailwindcss/theme' theme(reference);
            @import 'tailwindcss/utilities';
            @config '../tailwind.config.js';
            @source '../../project-b/src/**/*.html';
          `,
          'project-b/src/index.html': html`
            <div class="flex" />
          `,
          'project-b/src/index.js': js`
            const className = "content-['project-b/src/index.js']"
            module.exports = { className }
          `,
        },
      },
      async ({ root, spawn, getFreePort, fs }) => {
        let port = await getFreePort()
        await spawn(`pnpm vite dev --port ${port}`, {
          cwd: path.join(root, 'project-a'),
        })

        // Candidates are resolved lazily, so the first visit of index.html
        // will only have candidates from this file.
        await retryAssertion(async () => {
          let styles = await fetchStyles(port, '/index.html')
          expect(styles).toContain(candidate`underline`)
          expect(styles).toContain(candidate`flex`)
          expect(styles).not.toContain(candidate`font-bold`)
        })

        // Going to about.html will extend the candidate list to include
        // candidates from about.html.
        await retryAssertion(async () => {
          let styles = await fetchStyles(port, '/about.html')
          expect(styles).toContain(candidate`underline`)
          expect(styles).toContain(candidate`flex`)
          expect(styles).toContain(candidate`font-bold`)
        })

        await retryAssertion(async () => {
          // Updates are additive and cause new candidates to be added.
          await fs.write(
            'project-a/index.html',
            html`
              <head>
                <link rel="stylesheet" href="./src/index.css" />
              </head>
              <body>
                <div class="underline m-2">Hello, world!</div>
              </body>
            `,
          )

          let styles = await fetchStyles(port)
          expect(styles).toContain(candidate`underline`)
          expect(styles).toContain(candidate`flex`)
          expect(styles).toContain(candidate`font-bold`)
          expect(styles).toContain(candidate`m-2`)
        })

        await retryAssertion(async () => {
          // Manually added `@source`s are watched and trigger a rebuild
          await fs.write(
            'project-b/src/index.js',
            js`
              const className = "[.changed_&]:content-['project-b/src/index.js']"
              module.exports = { className }
            `,
          )

          let styles = await fetchStyles(port)
          expect(styles).toContain(candidate`underline`)
          expect(styles).toContain(candidate`flex`)
          expect(styles).toContain(candidate`font-bold`)
          expect(styles).toContain(candidate`m-2`)
          expect(styles).toContain(candidate`[.changed_&]:content-['project-b/src/index.js']`)
        })

        await retryAssertion(async () => {
          // After updates to the CSS file, all previous candidates should still be in
          // the generated CSS
          await fs.write(
            'project-a/src/index.css',
            css`
              ${await fs.read('project-a/src/index.css')}

              .red {
                color: red;
              }
            `,
          )

          let styles = await fetchStyles(port)
          expect(styles).toContain(candidate`red`)
          expect(styles).toContain(candidate`flex`)
          expect(styles).toContain(candidate`m-2`)
          expect(styles).toContain(candidate`underline`)
          expect(styles).toContain(candidate`[.changed_&]:content-['project-b/src/index.js']`)
          expect(styles).toContain(candidate`font-bold`)
        })
      },
    )

    test(
      'watch mode',
      {
        fs: {
          'package.json': json`{}`,
          'pnpm-workspace.yaml': yaml`
            #
            packages:
              - project-a
          `,
          'project-a/package.json': txt`
            {
              "type": "module",
              "dependencies": {
                "@tailwindcss/vite": "workspace:^",
                "tailwindcss": "workspace:^"
              },
              "devDependencies": {
                ${transformer === 'lightningcss' ? `"lightningcss": "^1.26.0",` : ''}
                "vite": "^5.3.5"
              }
            }
          `,
          'project-a/vite.config.ts': ts`
            import tailwindcss from '@tailwindcss/vite'
            import { defineConfig } from 'vite'

            export default defineConfig({
              build: { cssMinify: false },
              plugins: [tailwindcss()],
            })
          `,
          'project-a/index.html': html`
            <head>
              <link rel="stylesheet" href="./src/index.css" />
            </head>
            <body>
              <div class="underline text-primary">Hello, world!</div>
            </body>
          `,
          'project-a/tailwind.config.js': js`
            export default {
              content: ['../project-b/src/**/*.js'],
            }
          `,
          'project-a/src/index.css': css`
            @import 'tailwindcss/theme' theme(reference);
            @import 'tailwindcss/utilities';
            @import './custom-theme.css';
            @config '../tailwind.config.js';
            @source '../../project-b/src/**/*.html';
          `,
          'project-a/src/custom-theme.css': css`
            /* Will be overwritten later */
            @theme {
              --color-primary: black;
            }
          `,
          'project-b/src/index.html': html`
            <div class="flex" />
          `,
          'project-b/src/index.js': js`
            const className = "content-['project-b/src/index.js']"
            module.exports = { className }
          `,
        },
      },
      async ({ root, spawn, fs }) => {
        await spawn(`pnpm vite build --watch`, {
          cwd: path.join(root, 'project-a'),
        })

        let filename = ''
        await retryAssertion(async () => {
          let files = await fs.glob('project-a/dist/**/*.css')
          expect(files).toHaveLength(1)
          filename = files[0][0]
        })

        await fs.expectFileToContain(filename, [
          candidate`underline`,
          candidate`flex`,
          css`
            .text-primary {
              color: var(--color-primary, black);
            }
          `,
        ])

        await retryAssertion(async () => {
          await fs.write(
            'project-a/src/custom-theme.css',
            css`
              /* Overriding the primary color */
              @theme {
                --color-primary: red;
              }
            `,
          )

          let files = await fs.glob('project-a/dist/**/*.css')
          expect(files).toHaveLength(1)
          let [, styles] = files[0]

          expect(styles).toContain(css`
            .text-primary {
              color: var(--color-primary, red);
            }
          `)
        })

        await retryAssertion(async () => {
          // Updates are additive and cause new candidates to be added.
          await fs.write(
            'project-a/index.html',
            html`
              <head>
                <link rel="stylesheet" href="./src/index.css" />
              </head>
              <body>
                <div class="underline m-2">Hello, world!</div>
              </body>
            `,
          )

          let files = await fs.glob('project-a/dist/**/*.css')
          expect(files).toHaveLength(1)
          let [, styles] = files[0]
          expect(styles).toContain(candidate`underline`)
          expect(styles).toContain(candidate`flex`)
          expect(styles).toContain(candidate`m-2`)
        })

        await retryAssertion(async () => {
          // Manually added `@source`s are watched and trigger a rebuild
          await fs.write(
            'project-b/src/index.js',
            js`
              const className = "[.changed_&]:content-['project-b/src/index.js']"
              module.exports = { className }
            `,
          )

          let files = await fs.glob('project-a/dist/**/*.css')
          expect(files).toHaveLength(1)
          let [, styles] = files[0]
          expect(styles).toContain(candidate`underline`)
          expect(styles).toContain(candidate`flex`)
          expect(styles).toContain(candidate`m-2`)
          expect(styles).toContain(candidate`[.changed_&]:content-['project-b/src/index.js']`)
        })

        await retryAssertion(async () => {
          // After updates to the CSS file, all previous candidates should still be in
          // the generated CSS
          await fs.write(
            'project-a/src/index.css',
            css`
              ${await fs.read('project-a/src/index.css')}

              .red {
                color: red;
              }
            `,
          )

          let files = await fs.glob('project-a/dist/**/*.css')
          expect(files).toHaveLength(1)
          let [, styles] = files[0]
          expect(styles).toContain(candidate`underline`)
          expect(styles).toContain(candidate`flex`)
          expect(styles).toContain(candidate`m-2`)
          expect(styles).toContain(candidate`[.changed_&]:content-['project-b/src/index.js']`)
          expect(styles).toContain(candidate`red`)
        })
      },
    )

    test(
      `source(none) disables looking at the module graph`,
      {
        fs: {
          'package.json': json`{}`,
          'pnpm-workspace.yaml': yaml`
            #
            packages:
              - project-a
          `,
          'project-a/package.json': txt`
            {
              "type": "module",
              "dependencies": {
                "@tailwindcss/vite": "workspace:^",
                "tailwindcss": "workspace:^"
              },
              "devDependencies": {
                ${transformer === 'lightningcss' ? `"lightningcss": "^1.26.0",` : ''}
                "vite": "^5.3.5"
              }
            }
          `,
          'project-a/vite.config.ts': ts`
            import tailwindcss from '@tailwindcss/vite'
            import { defineConfig } from 'vite'

            export default defineConfig({
              css: ${transformer === 'postcss' ? '{}' : "{ transformer: 'lightningcss' }"},
              build: { cssMinify: false },
              plugins: [tailwindcss()],
            })
          `,
          'project-a/index.html': html`
            <head>
              <link rel="stylesheet" href="./src/index.css" />
            </head>
            <body>
              <div class="underline m-2">Hello, world!</div>
            </body>
          `,
          'project-a/src/index.css': css`
            @import 'tailwindcss' source(none);
            @source '../../project-b/src/**/*.html';
          `,
          'project-b/src/index.html': html`
            <div class="flex" />
          `,
          'project-b/src/index.js': js`
            const className = "content-['project-b/src/index.js']"
            module.exports = { className }
          `,
        },
      },
      async ({ root, fs, exec }) => {
        console.log(await exec('pnpm vite build', { cwd: path.join(root, 'project-a') }))

        let files = await fs.glob('project-a/dist/**/*.css')
        expect(files).toHaveLength(1)
        let [filename] = files[0]

        // `underline` and `m-2` are only present from files in the module graph
        // which we've explicitly disabled with source(none) so they should not
        // be present
        await fs.expectFileNotToContain(filename, [
          //
          candidate`underline`,
          candidate`m-2`,
        ])

        // The files from `project-b` should be included because there is an
        // explicit `@source` directive for it
        await fs.expectFileToContain(filename, [
          //
          candidate`flex`,
        ])

        // The explicit source directive only covers HTML files, so the JS file
        // should not be included
        await fs.expectFileNotToContain(filename, [
          //
          candidate`content-['project-b/src/index.js']`,
        ])
      },
    )

    test(
      `source("…") filters the module graph`,
      {
        fs: {
          'package.json': json`{}`,
          'pnpm-workspace.yaml': yaml`
            #
            packages:
              - project-a
          `,
          'project-a/package.json': txt`
            {
              "type": "module",
              "dependencies": {
                "@tailwindcss/vite": "workspace:^",
                "tailwindcss": "workspace:^"
              },
              "devDependencies": {
                ${transformer === 'lightningcss' ? `"lightningcss": "^1.26.0",` : ''}
                "vite": "^5.3.5"
              }
            }
          `,
          'project-a/vite.config.ts': ts`
            import tailwindcss from '@tailwindcss/vite'
            import { defineConfig } from 'vite'

            export default defineConfig({
              css: ${transformer === 'postcss' ? '{}' : "{ transformer: 'lightningcss' }"},
              build: { cssMinify: false },
              plugins: [tailwindcss()],
            })
          `,
          'project-a/index.html': html`
            <head>
              <link rel="stylesheet" href="/src/index.css" />
            </head>
            <body>
              <div class="underline m-2 content-['project-a/index.html']">Hello, world!</div>
              <script type="module" src="/app/index.js"></script>
            </body>
          `,
          'project-a/app/index.js': js`
            const className = "content-['project-a/app/index.js']"
            export default { className }
          `,
          'project-a/src/index.css': css`
            @import 'tailwindcss' source('../app');
            @source '../../project-b/src/**/*.html';
          `,
          'project-b/src/index.html': html`
            <div
              class="content-['project-b/src/index.html']"
            />
          `,
          'project-b/src/index.js': js`
            const className = "content-['project-b/src/index.js']"
            module.exports = { className }
          `,
        },
      },
      async ({ root, fs, exec }) => {
        await exec('pnpm vite build', { cwd: path.join(root, 'project-a') })

        let files = await fs.glob('project-a/dist/**/*.css')
        expect(files).toHaveLength(1)
        let [filename] = files[0]

        // `underline` and `m-2` are present in files in the module graph but
        // we've filtered the module graph such that we only look in
        // `./app/**/*` so they should not be present
        await fs.expectFileNotToContain(filename, [
          //
          candidate`underline`,
          candidate`m-2`,
          candidate`content-['project-a/index.html']`,
        ])

        // We've filtered the module graph to only look in ./app/**/* so the
        // candidates from that project should be present
        await fs.expectFileToContain(filename, [
          //
          candidate`content-['project-a/app/index.js']`,
        ])

        // Even through we're filtering the module graph explicit sources are
        // additive and as such files from `project-b` should be included
        // because there is an explicit `@source` directive for it
        await fs.expectFileToContain(filename, [
          //
          candidate`content-['project-b/src/index.html']`,
        ])

        // The explicit source directive only covers HTML files, so the JS file
        // should not be included
        await fs.expectFileNotToContain(filename, [
          //
          candidate`content-['project-b/src/index.js']`,
        ])
      },
    )
  })
}

test(
  `demote Tailwind roots to regular CSS files and back to Tailwind roots while restoring all candidates`,
  {
    fs: {
      'package.json': json`
        {
          "type": "module",
          "dependencies": {
            "@tailwindcss/vite": "workspace:^",
            "tailwindcss": "workspace:^"
          },
          "devDependencies": {
            "vite": "^5.3.5"
          }
        }
      `,
      'vite.config.ts': ts`
        import tailwindcss from '@tailwindcss/vite'
        import { defineConfig } from 'vite'

        export default defineConfig({
          build: { cssMinify: false },
          plugins: [tailwindcss()],
        })
      `,
      'index.html': html`
        <head>
          <link rel="stylesheet" href="./src/index.css" />
        </head>
        <body>
          <div class="underline">Hello, world!</div>
        </body>
      `,
      'about.html': html`
        <head>
          <link rel="stylesheet" href="./src/index.css" />
        </head>
        <body>
          <div class="font-bold">Tailwind Labs</div>
        </body>
      `,
      'src/index.css': css`@import 'tailwindcss';`,
    },
  },
  async ({ spawn, getFreePort, fs }) => {
    let port = await getFreePort()
    await spawn(`pnpm vite dev --port ${port}`)

    // Candidates are resolved lazily, so the first visit of index.html
    // will only have candidates from this file.
    await retryAssertion(async () => {
      let styles = await fetchStyles(port, '/index.html')
      expect(styles).toContain(candidate`underline`)
      expect(styles).not.toContain(candidate`font-bold`)
    })

    // Going to about.html will extend the candidate list to include
    // candidates from about.html.
    await retryAssertion(async () => {
      let styles = await fetchStyles(port, '/about.html')
      expect(styles).toContain(candidate`underline`)
      expect(styles).toContain(candidate`font-bold`)
    })

    await retryAssertion(async () => {
      // We change the CSS file so it is no longer a valid Tailwind root.
      await fs.write('src/index.css', css`@import 'tailwindcss';`)

      let styles = await fetchStyles(port)
      expect(styles).toContain(candidate`underline`)
      expect(styles).toContain(candidate`font-bold`)
    })
  },
)

test(
  `does not interfere with ?raw and ?url static asset handling`,
  {
    fs: {
      'package.json': json`
        {
          "type": "module",
          "dependencies": {
            "@tailwindcss/vite": "workspace:^",
            "tailwindcss": "workspace:^"
          },
          "devDependencies": {
            "vite": "^5.3.5"
          }
        }
      `,
      'vite.config.ts': ts`
        import tailwindcss from '@tailwindcss/vite'
        import { defineConfig } from 'vite'

        export default defineConfig({
          build: { cssMinify: false },
          plugins: [tailwindcss()],
        })
      `,
      'index.html': html`
        <head>
          <script type="module" src="./src/index.js"></script>
        </head>
      `,
      'src/index.js': js`
        import url from './index.css?url'
        import raw from './index.css?raw'
      `,
      'src/index.css': css`@import 'tailwindcss';`,
    },
  },
  async ({ spawn, getFreePort }) => {
    let port = await getFreePort()
    await spawn(`pnpm vite dev --port ${port}`)

    await retryAssertion(async () => {
      // We have to load the .js file first so that the static assets are
      // resolved
      await fetch(`http://localhost:${port}/src/index.js`).then((r) => r.text())

      let [raw, url] = await Promise.all([
        fetch(`http://localhost:${port}/src/index.css?raw`).then((r) => r.text()),
        fetch(`http://localhost:${port}/src/index.css?url`).then((r) => r.text()),
      ])

      expect(firstLine(raw)).toBe(`export default "@import 'tailwindcss';"`)
      expect(firstLine(url)).toBe(`export default "/src/index.css"`)
    })
  },
)

function firstLine(str: string) {
  return str.split('\n')[0]
}
