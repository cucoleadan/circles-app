// @ts-check

import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"
import react from "@astrojs/react"

import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  output: "server",
  server: {
    host: true,
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        "/api": "http://localhost:3000",
        "/.well-known": "http://localhost:3000",
      },
    },
  },

  integrations: [react()],

  adapter: node({
    mode: "standalone",
  }),
})
